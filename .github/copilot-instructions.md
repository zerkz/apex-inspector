<!-- Use this file to provide workspace-specific custom instructions to Copilot. For more details, visit https://code.visualstudio.com/docs/copilot/copilot-customization#_use-a-githubcopilotinstructionsmd-file -->

- Ingest `README.md` to provide context for the application. 
- Consider this is a chrome devtools extension.
- Every new HTML file needs to be added in the vite config.
- Do not ask the user to run `npm run build`, assume that they have a file watch process that auto-runs build. Inquire about the status of the build if you need it.