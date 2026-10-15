/**
 * What a device sees before anything is launched, or after the server started
 * again: the token is right, but there is nothing to run.
 *
 * Static, and without a script, so it cannot fail to load: a phone left on
 * its bookmark lands here and says why it is empty, styled like the player's
 * own overlay so that the two read as one page in two states.
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
      a {
        display: inline-block; margin-top: 16px; padding: 8px 20px; color: #d6d6d6;
        background: #383838; border-radius: 3px; text-decoration: none;
      }
    </style>
  </head>
  <body>
    <div>
      <p>Nothing is running yet. Choose Launch on Devices in the editor, then reload this page.</p>
      <a href="./">Reload</a>
    </div>
  </body>
</html>
`;
