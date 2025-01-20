import { Octokit } from "@octokit/rest";
import dotenv from "dotenv";
import fs from "fs";
import { stringify } from "csv-stringify/sync";
import { parse } from "url";

// Configure dotenv
dotenv.config();

// Initialize Octokit with GitHub token
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

// Exclude users based on the EXCLUDED_USERS environment variable
const excludedUsers = process.env.EXCLUDED_USERS
  ? process.env.EXCLUDED_USERS.split(",").map((user) => user.trim())
  : [];

// Function to parse repository details from URL
function parseRepoUrl(url) {
  const { pathname } = parse(url);
  const [owner, repo] = pathname.slice(1).split("/");
  return { owner, repo: repo.replace(/\.git$/, "") };
}

// Function to get user email
async function getUserEmail(username) {
  try {
    const { data } = await octokit.rest.users.getByUsername({ username });
    return data.email || "Not available";
  } catch {
    return "Not available";
  }
}

// Function to get all pull requests for a repository
async function getPullRequests(owner, repo, sinceDate, untilDate) {
  const pullRequests = [];
  let page = 1;
  const perPage = 100;

  console.log(
    `Fetching pull requests for ${owner}/${repo} from ${sinceDate} to ${
      untilDate || "now"
    }...`
  );

  while (true) {
    const response = await octokit.rest.pulls.list({
      owner,
      repo,
      state: "closed",
      sort: "updated",
      direction: "desc",
      per_page: perPage,
      page,
    });

    const { data, headers } = response;

    // Log rate limit information
    console.log(
      `Rate Limit from Github API: Limit=${headers["x-ratelimit-limit"]}, Remaining=${headers["x-ratelimit-remaining"]}, Used=${headers["x-ratelimit-used"]}, Reset=${headers["x-ratelimit-reset"]}, Resource=${headers["x-ratelimit-resource"]}`
    );

    if (data.length === 0) break;

    const filteredPRs = data.filter((pr) => {
      const updatedAt = new Date(pr.updated_at);
      return (
        updatedAt >= new Date(sinceDate) &&
        (!untilDate || updatedAt <= new Date(untilDate))
      );
    });
    pullRequests.push(...filteredPRs);

    if (data.length < perPage) break;
    page++;
  }

  return pullRequests;
}

// Function to get review times from PRs
async function getReviewTimes(owner, repo, pullRequests) {
  const reviewTimes = [];
  for (const pr of pullRequests) {
    const reviews = await octokit.rest.pulls.listReviews({
      owner,
      repo,
      pull_number: pr.number,
    });

    if (reviews.data.length > 0) {
      const createdAt = new Date(pr.created_at);
      const firstReview = new Date(reviews.data[0].submitted_at);
      const reviewTime = (firstReview - createdAt) / (1000 * 60 * 60); // Hours
      reviewTimes.push(reviewTime);
    }
  }
  return reviewTimes;
}

// Function to calculate statistical mean and mean without outliers
function calculateStats(values) {
  if (values.length === 0) return { mean: 0, meanWithoutOutliers: 0 };

  const mean = (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2);

  // Remove outliers (values beyond 1.5x IQR)
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length / 4)];
  const q3 = sorted[Math.floor((sorted.length * 3) / 4)];
  const iqr = q3 - q1;
  const filtered = sorted.filter(
    (x) => x >= q1 - 1.5 * iqr && x <= q3 + 1.5 * iqr
  );

  const meanWithoutOutliers = (
    filtered.reduce((a, b) => a + b, 0) / filtered.length
  ).toFixed(2);

  return { mean, meanWithoutOutliers };
}

// Function to analyze PR data
async function analyzePullRequests(owner, repo, pullRequests) {
  const prAuthors = {};
  const reviewers = {};
  const commits = {};
  const cycleTimes = [];
  const prSizes = [];
  const filesPerPR = [];

  for (const pr of pullRequests) {
    const author = pr.user?.login;

    if (author && !excludedUsers.includes(author)) {
      if (!prAuthors[author]) {
        const email = await getUserEmail(author);
        prAuthors[author] = { count: 0, email };
      }
      prAuthors[author].count += 1;
    }

    // Fetch actual reviewers from the reviews API
    const reviews = await octokit.rest.pulls.listReviews({
      owner,
      repo,
      pull_number: pr.number,
    });

    await Promise.all(
      reviews.data.map(async (review) => {
        const reviewerLogin = review.user?.login;
        if (reviewerLogin && !excludedUsers.includes(reviewerLogin)) {
          if (!reviewers[reviewerLogin]) {
            const email = await getUserEmail(reviewerLogin);
            reviewers[reviewerLogin] = { count: 0, email };
          }
          reviewers[reviewerLogin].count += 1;
        }
      })
    );

    if (pr.merged_at) {
      const createdAt = new Date(pr.created_at);
      const mergedAt = new Date(pr.merged_at);
      cycleTimes.push((mergedAt - createdAt) / (1000 * 60 * 60)); // Hours
    }

    const prDetails = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: pr.number,
    });

    const additions = prDetails.data.additions || 0;
    const deletions = prDetails.data.deletions || 0;
    const changedFiles = prDetails.data.changed_files || 0;

    if (additions > 0 || deletions > 0) {
      prSizes.push(additions + deletions);
    }

    if (changedFiles > 0) {
      filesPerPR.push(changedFiles);
    }
  }

  const { mean: averageReviewTime, meanWithoutOutliers: adjustedReviewTime } =
    calculateStats(await getReviewTimes(owner, repo, pullRequests));

  return {
    prAuthors,
    reviewers,
    averageCycleTime: cycleTimes.length
      ? (cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length).toFixed(2)
      : 0,
    averageReviewTime,
    adjustedReviewTime,
    averagePrSize: prSizes.length
      ? (prSizes.reduce((a, b) => a + b, 0) / prSizes.length).toFixed(2)
      : 0,
    averageFilesPerPR: filesPerPR.length
      ? (filesPerPR.reduce((a, b) => a + b, 0) / filesPerPR.length).toFixed(2)
      : 0,
  };
}

// Generate CSV reports
function generateCSVReports(data) {
  const engagementRows = [];
  const activityScores = {};
  const commitScores = {};
  const reviewScores = {};
  const emails = {};

  Object.entries(data).forEach(([repo, stats]) => {
    Object.entries(stats.prAuthors).forEach(([author, info]) => {
      engagementRows.push({
        repository: repo,
        category: "PR Authors",
        author,
        email: info.email,
        count: info.count,
      });
      activityScores[author] = (activityScores[author] || 0) + info.count;
      commitScores[author] = (commitScores[author] || 0) + info.count;
      emails[author] = info.email;

    });

    Object.entries(stats.reviewers).forEach(([reviewer, info]) => {
      engagementRows.push({
        repository: repo,
        category: "Reviewers",
        author: reviewer,
        email: info.email,
        count: info.count,
      });
      activityScores[reviewer] = (activityScores[reviewer] || 0) + info.count;
      reviewScores[reviewer] = (reviewScores[reviewer] || 0) + info.count;
      emails[reviewer] = info.email;

    });
  });

  const engagementCsv = stringify(engagementRows, { header: true });
  fs.writeFileSync("engagement_report.csv", engagementCsv);

  const metricsRows = [];
  Object.entries(data).forEach(([repo, stats]) => {
    metricsRows.push({
      repository: repo,
      metric: "Average Cycle Time (hrs)",
      value: stats.averageCycleTime,
    });
    metricsRows.push({
      repository: repo,
      metric: "Average Review Time (hrs)",
      value: stats.averageReviewTime,
    });
    metricsRows.push({
      repository: repo,
      metric: "Adjusted Review Time (hrs)",
      value: stats.adjustedReviewTime,
    });
    metricsRows.push({
      repository: repo,
      metric: "Average PR Size (LOC)",
      value: stats.averagePrSize,
    });
    metricsRows.push({
      repository: repo,
      metric: "Average Files per PR",
      value: stats.averageFilesPerPR,
    });
  });

  const metricsCsv = stringify(metricsRows, { header: true });
  fs.writeFileSync("metrics_report.csv", metricsCsv);

  // Generate Top Contributors Report
  const topContributors = Object.entries(activityScores)
    .sort(([, a], [, b]) => b - a)
    .map(([author, score]) => ({ author, email: emails[author] || "Not available", score }));

  const topCommitters = Object.entries(commitScores)
    .sort(([, a], [, b]) => b - a)
    .map(([author, score]) => ({ author, email: emails[author] || "Not available", score }));

  const topReviewers = Object.entries(reviewScores)
    .sort(([, a], [, b]) => b - a)
    .map(([author, score]) => ({ author, email: emails[author] || "Not available", score }));

  const topContributorsCsv = stringify(
    [
      ...topCommitters.map((c) => ({ ...c, category: "Top Committers" })),
      ...topReviewers.map((r) => ({ ...r, category: "Top Reviewers" })),
      ...topContributors.map((t) => ({ ...t, category: "Top Overall" })),
    ],
    { header: true }
  );

  fs.writeFileSync("top_contributors.csv", topContributorsCsv);

  console.log(
    "Reports saved: engagement_report.csv, metrics_report.csv, top_contributors.csv"
  );
}

// Main function with parallel processing
async function main() {
  if (
    !process.env.GITHUB_TOKEN ||
    !process.env.REPO_URLS 
  ) {
    console.error(
      "Please define GITHUB_TOKEN, REPO_URLS in your .env file."
    );
    process.exit(1);
  }

  const repoUrls = process.env.REPO_URLS.split(",").map((url) => url.trim());
  const sinceDays = parseInt(process.env.SINCE_DAYS, 10);
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - sinceDays);

  let intervalDates = null;
  if (process.env.INTERVAL_DATES) {
    const dates = process.env.INTERVAL_DATES.split(",").map(
      (date) => new Date(date.trim())
    );
    if (dates.length === 2) {
      intervalDates = { from: dates[0], to: dates[1] };
    }
  }

  const finalSinceDate = intervalDates ? intervalDates.from : sinceDate;
  const untilDate = intervalDates ? intervalDates.to : null;

  console.log("Starting analysis of repositories in parallel...");

  const results = await Promise.all(
    repoUrls.map(async (repoUrl) => {
      const { owner, repo } = parseRepoUrl(repoUrl);
      try {
        const pullRequests = await getPullRequests(
          owner,
          repo,
          finalSinceDate.toISOString(),
          untilDate?.toISOString()
        );
        const analysis = await analyzePullRequests(owner, repo, pullRequests);
        return { repo: `${owner}/${repo}`, analysis };
      } catch (error) {
        if (error.response) {
          console.error(`Error processing ${owner}/${repo}:`, error.message);
          console.error(`Status: ${error.response.status}`);
          console.error(`Headers:`, error.response.headers);
          console.error(`Data:`, error.response.data);
        } else {
          console.error(`Error processing ${owner}/${repo}:`, error.message);
        }
        return { repo: `${owner}/${repo}`, analysis: null };
      }
    })
  );

  const analysisResults = {};
  results.forEach(({ repo, analysis }) => {
    if (analysis) {
      analysisResults[repo] = analysis;
    }
  });

  generateCSVReports(analysisResults);
}

main().catch((error) => console.error(error));
