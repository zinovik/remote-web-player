#!/usr/bin/env node

const { exec } = require("child_process");
const { promisify } = require("util");
const express = require("express");
const ngrok = require("ngrok");

const SOURCE_PATH = "/media/max/Windows/music";
const PORT = 3003;
const STOP = "STOP";

let filePaths;

(async () => {
  const { stdout: treeOutput } = await promisify(exec)(
    `tree ${SOURCE_PATH} -f`,
    {
      maxBuffer: 1024 * 1024 * 4,
    }
  );

  filePaths = treeOutput
    .split("\n")
    .filter((filePath) => filePath.endsWith(".mp3"))
    .map((filePath) => filePath.substring(filePath.indexOf(SOURCE_PATH)));

  const url = await ngrok.connect({ addr: PORT });
  console.log(url);
})();

const getPage = () => `<html>
<head>
  <script>
    const clickHandler = async (fileShortPathBase64) => {
      const response = await fetch('/' + fileShortPathBase64);
      if (response.status >= 300) alert('error');
    }
  </script>
</head>
  <body>
  ${[STOP, ...filePaths]
    .map((filePath) => {
      const fileShortPath = filePath.replace(`${SOURCE_PATH}/`, "");

      return `<div onClick="clickHandler('${Buffer.from(fileShortPath).toString(
        "base64"
      )}')" style="cursor: pointer;">
        ${fileShortPath}
      </div>`;
    })
    .join("\n")}
  </body>
</html>`;

let controller = null;

const startSong = (filePath) => {
  if (controller) controller.abort();

  controller = new AbortController();
  const { signal } = controller;

  exec(
    `mplayer "${filePath}"`,
    {
      maxBuffer: 1024 * 1024 * 4,
      signal,
    },
    (error) => {
      if (!error) {
        controller = null;
        const current = filePaths.indexOf(filePath);
        startSong(filePaths[current + 1]);
      }
    }
  );
};

const stopSong = () => {
  if (controller) controller.abort();
};

const app = express();

app.get("/", (_, res) => {
  res.send(getPage());
});

app.get("/:fileShortPathBase64", (req, res) => {
  const fileShortPath = Buffer.from(
    req.params.fileShortPathBase64,
    "base64"
  ).toString("ascii");

  console.log(fileShortPath);

  if (fileShortPath === STOP) {
    stopSong();
    res.send();
    return;
  }

  const regExp = new RegExp(
    /[A-z\d\-&() ]+\/\d\d\d\d - [A-z\d\-\[\]&() ]+\/\d\d - [A-z\d\-\[\]&() ]+.mp3/
  );

  if (!regExp.test(fileShortPath)) return res.status(400).send("error");

  startSong(`${SOURCE_PATH}/${fileShortPath}`);

  res.send();
});

app.listen(PORT, () => {
  console.log(`App listening on port ${PORT}`);
});
