# GitHub API PR Analysis

This project provides a script to analyze pull requests (PRs) across multiple GitHub repositories using the GitHub REST API. It collects data such as PR authors, reviewers, review times, cycle times, and generates various reports in CSV format.

## Features

- **Pull Request Analysis**: Extracts detailed information about PR authors, reviewers, and their contributions.
- **Cycle Time Metrics**: Calculates average cycle time and review time, with outlier adjustments.
- **Top Contributors**: Identifies top committers, reviewers, and overall contributors based on activity.
- **Comprehensive Reports**: Generates CSV files with engagement, metrics, and top contributors data.

## Requirements

- Node.js (v16 or higher) (We recomend install using by NVM https://github.com/nvm-sh/nvm )
- GitHub Personal Access Token
- Access to VPN

## Setup

1. Clone the repository:
   ```bash
   git clone [<repository-url>](https://github.com/jhomarolo/github-pr-analysis)
   cd <repository-folder>
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file in the project root:
   ```plaintext
   GITHUB_TOKEN=<your_github_token>
   REPO_URLS=<comma_separated_repository_urls>
   SINCE_DAYS=<number_of_days>
   INTERVAL_DATES=<start_date,end_date>
   EXCLUDED_USERS=<comma_separated_usernames_to_exclude>
   ```

   - `GITHUB_TOKEN`: Your GitHub personal access token.
   - `REPO_URLS`: List of repository URLs to analyze separated by coma.
   - `SINCE_DAYS`: The number of past days to include in the analysis (ignored if `INTERVAL_DATES` is set).
   - `INTERVAL_DATES`: (Optional) A specific date range in the format `YYYY-MM-DD,YYYY-MM-DD` to analyze. When provided, this takes precedence over `SINCE_DAYS`.
   - `EXCLUDED_USERS`: (Optional) List of GitHub usernames to exclude from the analysis separated by coma.

## Usage

Run the script:
```bash
node github_api_pr_analysis.js
```

The script will analyze the repositories specified in the `.env` file and generate the following CSV files:

1. **engagement_report.csv**: Contains PR author and reviewer engagement details.
2. **metrics_report.csv**: Includes metrics such as average cycle time, review time, and PR sizes.
3. **top_contributors.csv**: Highlights the top contributors in three categories:
   - Top Committers
   - Top Reviewers
   - Top Overall Contributors

## Reports

### Engagement Report
- Lists contributors categorized as "PR Authors" or "Reviewers".
- Includes the number of contributions and email addresses of contributors.

### Metrics Report
- Average cycle time (hours)
- Average review time (hours)
- Adjusted review time (hours) excluding outliers
- Average PR size (lines of code)
- Average number of files per PR

### Top Contributors Report
- Top 5 Committers
- Top 5 Reviewers
- Top 10 Overall Contributors
- Each entry includes the contributor's username, email, and activity score.

## Date Range Logic

- **SINCE_DAYS**: Specifies the number of days from today to include in the analysis.
- **INTERVAL_DATES**: When set, overrides `SINCE_DAYS` and allows you to specify a custom date range in the format `YYYY-MM-DD,YYYY-MM-DD`. For example, setting `INTERVAL_DATES=2024-01-01,2024-03-01` analyzes data from January 1, 2024, to March 1, 2024.

If both `SINCE_DAYS` and `INTERVAL_DATES` are set, `INTERVAL_DATES` takes precedence.

## Error Handling

The script logs detailed error messages if the GitHub API rate limit is exceeded or if any other API errors occur. Ensure your GitHub token has sufficient permissions and regenerate it if needed.

## License

This project is licensed under the MIT License. See the `LICENSE` file for details.
