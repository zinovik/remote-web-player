const { exec } = require("child_process");
const { promisify } = require("util");
const express = require("express");

const SOURCE_PATH = "/media/max/Windows/music";
const PORT = 3001;

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
})();

const getPage = () => `<html>
<head>
</head>
<body>
${filePaths
  .map((filePath) => {
    const fileShortPath = filePath.replace(`${SOURCE_PATH}/`, "");
    const fileShortPathBase64 = Buffer.from(fileShortPath).toString("base64");

    return `<div><a href="/${fileShortPathBase64}=">${fileShortPath}</a></div>`;
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

const app = express();

app.get("/", (req, res) => {
  res.send(getPage());
});

app.get("/:fileShortPathBase64", (req, res) => {
  const fileShortPath = Buffer.from(
    req.params.fileShortPathBase64,
    "base64"
  ).toString("ascii");

  const regExp = new RegExp(
    /[a-zA-Z\d\-() ]+\/\d\d\d\d - [a-zA-Z\d\-() ]+\/\d\d - [a-zA-Z\d\-() ]+.mp3/
  );

  if (!regExp.test(fileShortPath)) return res.send("error");

  startSong(`${SOURCE_PATH}/${fileShortPath}`);

  res.send(getPage());
});

app.listen(PORT, () => {
  console.log(`App listening on port ${PORT}`);
});
