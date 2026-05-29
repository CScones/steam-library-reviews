# Steam Library Reviews

Adds store-style **Overall Reviews** and **Recent Reviews** summaries to the Steam Library game details page by pulling review data from a local proxy endpoint.

## What it does

When you open a game in your Steam Library, this plugin watches the main Steam shell UI, detects the Library details page, finds the nearby app ID, requests review summary data from a local proxy, and inserts a small two-line review block near the game metadata.

## Requirements

- Millennium installed and working in Steam
- A local review proxy running at `http://127.0.0.1:32145/reviews`
- Steam fully restarted after enabling or updating the plugin

## Install for normal use

1. Place this plugin folder inside your Millennium `plugins` directory.
2. Enable the plugin from Millennium’s Plugins area in Steam.
3. Fully exit and reopen Steam.
4. Open a game in your Library and look for the injected review summary block.

## Editing / rebuilding

This plugin was developed from the Millennium PluginTemplate. If you are editing the source files, run the development build command after changes:

```bash
pnpm run dev
```

You only need to run that after changing source files such as `frontend/index.tsx` or `webkit/index.tsx`. If nothing changed, you do not need to run it again just to use the plugin.

## Project structure

- `frontend/index.tsx`  
  Main Steam shell hook and Library review injection logic.

- `webkit/index.tsx`  
  Currently unused for the review feature. Safe to leave as a no-op.

- `backend/main.lua`  
  Lua backend required by the template/plugin structure.

- `plugin.json`  
  Millennium plugin manifest and display metadata.

## Notes

- The plugin depends on the local proxy endpoint. If the proxy is not running, the review block may show an error or fail to load.
- This plugin targets the main Steam shell window rather than relying on Store page webkit injection.
- If Steam does not reflect an update, do a full Steam exit and reopen it.

## Troubleshooting

### Review block does not appear

- Confirm the plugin is enabled in Millennium
- Confirm the local proxy is running at `http://127.0.0.1:32145/reviews`
- Fully exit Steam and reopen it

### Plugin works but changes do not show

If you edited source files, run:

```bash
pnpm run dev
```

Then fully restart Steam.

### Store page still shows an old test banner

Make sure `webkit/index.tsx` was cleaned up and rebuilt, then restart Steam.

## Development reminder

For day-to-day use, treat this as a normal installed plugin.

For source edits, use this flow:

1. Edit source
2. Run `pnpm run dev`
3. Restart Steam
4. Test again

That build step is for development only, not normal use.
