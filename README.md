# Steam Library Reviews

A Millennium plugin that adds Steam review summaries directly to the Steam Library game details panel.

It fetches review data from a tiny local proxy, inserts an **Overall Reviews** and **Recent Reviews** block below the game metadata, keeps the game details panel visible, and removes the Steam dim-state class that was hiding or muting the panel in the working layout.[cite:666][cite:667][cite:672]

## Features

- Adds review rows under the game details area.
- Shows review count and review label.
- Applies colored review text, including a rainbow effect for **Overwhelmingly Positive**.
- Uses request cancellation to avoid stale updates during fast navigation.[cite:648][cite:654]
- Removes the discovered dim-state class from the game info area so the panel stays readable.

## Files

| File | Purpose |
|---|---|
| `index.tsx` | Main Millennium plugin entry point. Watches Steam's Library UI, injects the review block, removes the dim class, and fetches review data from the local proxy. |
| `server.js` | Small local proxy server that requests Steam review summary data and returns normalized JSON. |

## How it works

The plugin watches the Steam Library DOM for navigation and layout changes, then finds the current app ID from nearby links, images, attributes, or the current URL. It inserts a review block under the `Developer:` metadata row and updates it with proxy data for the currently selected game.[cite:666][cite:672]

The final working version avoids a self-triggering MutationObserver loop by ignoring changes caused by its own injected review block and by not repeatedly rerendering the same app state unless the selected game changes.[cite:666][cite:667][cite:672]

The frontend also aborts in-flight fetches when switching games so stale responses do not overwrite the newest selection, which is a standard use case for `AbortController` in fast-changing UIs.[cite:648][cite:654]

## Setup

### 1. Start the proxy

Run the local proxy before launching or testing the plugin:

```bash
node server.js
```

Expected local endpoint:

```text
http://127.0.0.1:32145/reviews?appid=620
```

### 2. Update the plugin entry file

Replace your current plugin `index.tsx` with the cleaned working version.

### 3. Reload Steam / Millennium

Reload the plugin or restart Steam after saving changes.

## Notes

- `server.js` can stay as-is if it is already returning correct review JSON.
- `index.tsx` is the main file you update when changing UI behavior.
- The current implementation prefers fresh fetches over a frontend memory cache because the cache path was not providing reliable value for this navigation pattern.[cite:657][cite:659]
- If the Steam UI changes class names in a future client update, the selectors for the game details box or dim-state class may need to be rediscovered.

## Returned proxy shape

Example response from the local proxy:

```json
{
  "appid": "620",
  "overall": {
    "total_reviews": 123456,
    "review_score_desc": "Very Positive"
  },
  "recent": {
    "total_reviews": null,
    "review_score_desc": "Unavailable"
  }
}
```

## Troubleshooting

### Reviews keep refreshing constantly

That usually means the DOM observer is reacting to the plugin's own DOM updates. The working fix is to ignore mutations inside the injected review block and avoid rerendering unchanged app state.[cite:666][cite:667][cite:672]

### The game info panel looks dim again

The dimming was traced to a specific Steam class: `_1FXWy2UilVZIppT-PetDWw`. If Steam changes its UI again, inspect the parent game info container in DevTools and find the new class causing the dim state.

### Reviews do not load

Check that:

- `server.js` is running.
- The proxy is reachable on `127.0.0.1:32145`.
- The selected game has a detectable Steam app ID.
- The proxy returns JSON instead of an error.

## Future improvements

- Add typed interfaces on the server side too for easier maintenance.[cite:647][cite:656]
- Optionally add a safer teardown path if the plugin ever needs to disconnect observers during unload, since MutationObservers are meant to be disconnected when no longer needed.[cite:627][cite:630]
- Add a fallback strategy if Steam changes the metadata anchor row or class names.
