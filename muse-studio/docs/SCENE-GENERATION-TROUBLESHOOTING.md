# Scene generation troubleshooting

If your project has a **confirmed storyline** but **no scenes** ("No scenes yet" on the Kanban), use this guide to trace what happened and how to fix it.

## How scene generation is supposed to work

1. **Storyline** — You create a storyline (with Story Muse or manually) and see "Storyline Draft · Ready for Review".
2. **Confirm** — You click **"Confirm & Proceed to Scene Scripts"** (or "Confirm Storyline & Proceed to Scene Scripts"). This:
   - Saves the storyline to the database and sets `storylineConfirmed = true`.
   - Navigates to the same project page with **`?generating=scenes&targetScenes=N`** in the URL (N = number you chose, e.g. 8).
3. **Overlay** — The project page sees the `generating=scenes` query and shows the **Scene Generation** overlay instead of the Kanban.
4. **API** — The overlay immediately calls **`POST /api/generate/scenes`** with `{ projectId, targetScenes }`. The API:
   - Loads the confirmed storyline from the DB.
   - Uses your configured LLM (Ollama / OpenAI / Claude / LM Studio) to generate scene scripts in `<<<SCENE>>>...<<<END>>>` format.
   - Parses each block and inserts scenes into the DB, streaming progress via Server-Sent Events (SSE).
5. **Done** — When generation finishes, the overlay shows "Done" and then redirects to the Kanban (without the query), so you see your new scenes.

## Why you might see "No scenes yet" with a confirmed storyline

- **Scene generation was never started**  
  The redirect to `?generating=scenes` did not happen (e.g. you closed the tab, refreshed, or navigated away right after clicking Confirm). You end up on the Kanban with 0 scenes.

- **Scene generation failed**  
  The overlay called the API but the LLM request failed (timeout, wrong API key, Ollama not running, model not loaded). You may have seen "Scene generation failed" in the overlay, or you navigated away before the error appeared.

- **Scene generation returned 0 scenes**  
  The LLM responded but the response had no valid `<<<SCENE>>>...<<<END>>>` blocks (format not followed). The API then sends `done` with 0 scenes and redirects to the Kanban.

## What to check

### 1. Re-trigger scene generation (quick fix)

If the storyline is confirmed but you have no scenes, you can run scene generation again by opening the project with the right query:

- Replace `YOUR_PROJECT_ID` with your project id (from the URL, e.g. `proj-xxx`):
  ```
  http://localhost:3000/projects/YOUR_PROJECT_ID?generating=scenes&targetScenes=8
  ```
- Or use the **"Generate scene scripts"** button on the Kanban when there are no scenes (see below).

### 2. Browser: Network tab

1. Open DevTools (F12) → **Network**.
2. Trigger scene generation (Confirm again from storyline, or open the URL above).
3. Find the request to **`/api/generate/scenes`** (method POST).
   - **Status 400** — "Missing projectId" or "Project has no confirmed storyline" → project id not sent or storyline not saved; check that you confirmed the storyline and that the project id in the URL is correct.
   - **Status 200** but no scenes in the response — Response is SSE; check the **EventStream** or response body for `event: error` (message will describe the failure).
   - **Failed / CORS / timeout** — Backend or LLM unreachable; see next section.

### 3. LLM configuration (Settings)

Scene generation uses the **same LLM as Story Muse**, configured in **Settings** (muse-studio):

- **Ollama** — Ollama must be running (`http://localhost:11434` or your `OLLAMA_BASE_URL`). The model you use for Story Muse (e.g. `ollama_model` in settings) must be loaded. If it isn’t, the `/api/generate/scenes` request can hang or fail.
- **OpenAI** — `OPENAI_API_KEY` must be set in **muse-studio** (e.g. in `.env.local`), because the Next.js API route calls OpenAI from the server.
- **Claude** — `ANTHROPIC_API_KEY` must be set in **muse-studio**.
- **LM Studio** — LM Studio app must be running with the OpenAI-compatible server enabled; the scene API uses the same base URL as Story Muse.

### 4. Server logs

- **Next.js (muse-studio)** — In the terminal where you run `npm run dev`, look for errors when you trigger scene generation (e.g. "Failed to parse scenes POST body", "Unable to parse scene block", or LLM/network errors).
- **Python backend (muse_backend)** — Scene generation is done by the **Next.js** API route, not the Python backend. The Python backend is used for Story Muse streaming in the UI and for image/video; if only scene generation fails, the problem is in the Next.js route or LLM config above.

## Adding a "Generate scene scripts" button

When the project has a confirmed storyline but **no scenes**, the Kanban can show a button that takes you to the same URL with `?generating=scenes&targetScenes=8` so you don’t have to edit the URL by hand. See the code change in the Kanban/overview area that adds this button when `scenes.length === 0 && project.storylineConfirmed`.
