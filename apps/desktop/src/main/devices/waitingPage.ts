/**
 * What a device sees before anything is launched, or after the server started
 * again: the token is right, but there is nothing to run.
 *
 * Static, and without a script of its own, so it cannot fail to load, styled
 * like the player's own overlay so that the two read as one page in two
 * states. The server adds the device client to it as it does to the player,
 * and the client rewrites `#studio-state` as the link comes and goes, then
 * reloads the page into the game when a launch arrives. The Reload link stays
 * for a browser in which the client cannot run.
 */
export const WAITING_PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Waiting for Three Studio</title>
    <link rel="icon" type="image/svg+xml" href="./favicon.svg" />
    <style>
      html, body { margin: 0; height: 100%; }
      body {
        display: grid; place-items: center; padding: 24px; box-sizing: border-box;
        font: 13px/1.5 ui-sans-serif, system-ui, sans-serif; color: #d6d6d6;
        background: #1b1b1b; text-align: center;
      }
      #studio-state { color: #8f8f8f; }
      a {
        display: inline-block; margin-top: 16px; padding: 8px 20px; color: #d6d6d6;
        background: #383838; border-radius: 3px; text-decoration: none;
      }
    </style>
  </head>
  <body>
    <div>
      <p>Nothing is running yet. Choose Launch on Devices in the editor: this page starts the game on its own.</p>
      <p id="studio-state">Connecting to Three Studio…</p>
      <a href="./">Reload</a>
    </div>
  </body>
</html>
`;
