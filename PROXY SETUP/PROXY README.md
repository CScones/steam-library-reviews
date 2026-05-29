\# Steam Library Reviews Proxy



This folder contains the local proxy component used by the Steam Library Reviews plugin.



The Steam plugin reads review data from this local endpoint:



```text

http://127.0.0.1:32145/reviews?appid=APPID

```



That means something on your PC must be listening on port `32145` and returning JSON in the format the plugin expects.



\## How it works



The plugin does \*\*not\*\* call Steam directly.



Instead, the flow looks like this:



```text

Steam plugin -> localhost:32145 -> local proxy -> Cloudflare Worker -> Steam review data

```



The local proxy runs on your computer and forwards app ID requests to your Cloudflare Worker, then returns the Worker’s JSON response back to the plugin.



\## Requirements



\- \[Node.js](https://nodejs.org/)

\- npm, which is included with Node.js

\- A deployed Cloudflare Worker that accepts an `appid` query parameter and returns review summary JSON



\## Setup



1\. Open a terminal or Command Prompt in this `Proxy` folder.

2\. Initialize npm if needed:



```bash

npm init -y

```



3\. Install Express:



```bash

npm install express

```



4\. Create a file named `server.js` in this folder.

5\. Paste your local proxy bridge code into `server.js`.

6\. Start the proxy:



```bash

node server.js

```



If the server starts correctly, it should keep running and listen on `127.0.0.1:32145`.



\## Cloudflare Worker



Your Worker should be publicly reachable at a URL like one of these:



```text

https://your-worker.your-subdomain.workers.dev

https://reviews.example.com

```



The local proxy should forward requests like:



```text

http://127.0.0.1:32145/reviews?appid=1675830

```



to something like:



```text

https://your-worker.your-subdomain.workers.dev/?appid=1675830

```



\## Testing



\### Test the Worker directly



Open your Worker URL in a browser with a real app ID:



```text

https://your-worker.your-subdomain.workers.dev/?appid=1675830

```



If it works, you should get JSON back.



\### Test the local proxy



Then test the localhost bridge:



```text

http://127.0.0.1:32145/reviews?appid=1675830

```



If this works, the Steam plugin should be able to read it too.



\## Expected response shape



The plugin expects JSON in this general format:



```json

{

&#x20; "overall": {

&#x20;   "total\_reviews": 12345,

&#x20;   "review\_score\_desc": "Very Positive"

&#x20; },

&#x20; "recent": {

&#x20;   "total\_reviews": 321,

&#x20;   "review\_score\_desc": "Mostly Positive"

&#x20; }

}

```



\## Troubleshooting



\### Worker works but plugin does not



\- Make sure the local proxy is still running

\- Make sure the proxy forwards to the correct Worker URL

\- Test both the Worker URL and the localhost URL manually

\- If the Worker returns JSON but localhost does not, the issue is in the local proxy



\### Local proxy does not start



\- Make sure Node.js is installed

\- Make sure you ran `npm install express`

\- Make sure `server.js` exists in this folder

\- Try running `node server.js` again and read the terminal error



\### Plugin shows fetch or HTTP errors



\- Confirm the Worker is live

\- Confirm the local proxy is running on port `32145`

\- Confirm the Worker returns valid JSON

