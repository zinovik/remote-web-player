#!/usr/bin/env node

const { exec } = require("child_process");
const { promisify } = require("util");
const express = require("express");
const ngrok = require("ngrok");

const getCommandLineParameter = (processArgv, name) => {
  const nameIndex = processArgv.indexOf(name);

  return nameIndex > -1 ? processArgv[nameIndex + 1] : null;
};

const SOURCE_PATH =
  getCommandLineParameter(process.argv, "source-path") ||
  "/media/max/Windows/music";
const PORT = getCommandLineParameter(process.argv, "port") || 3003;

const getPlayerCommand = (filePath) => `mplayer "${filePath}"`;
const getVolumeCommand = (volume) => `amixer sset 'Master' ${volume}%`;
const runCommand = async (command, signal) => {
  const { stdout } = await promisify(exec)(command, {
    maxBuffer: 1024 * 1024 * 4,
    ...(signal ? { signal } : {}),
  });

  return stdout;
};

let filePaths;
let currentController = null;
let currentSongIndex = 0;
let currentVolume;

(async () => {
  const treeOutput = await runCommand(`tree ${SOURCE_PATH} -f`);

  filePaths = treeOutput
    .split("\n")
    .filter((filePath) => filePath.endsWith(".mp3"))
    .map((filePath) => filePath.substring(filePath.indexOf(SOURCE_PATH)));

  const url = await ngrok.connect({ addr: PORT });
  console.log(url);
})();

const getPage = () => `<!DOCTYPE html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  </head>

  <body>
  <script>
    let lastSongIndex;

    const updateCurrentInfo = (currentSongIndex, currentVolume) => {
      if (currentSongIndex !== lastSongIndex) {
        const songElement = document.getElementById('song-' + currentSongIndex);
        if (songElement) {
          songElement.style.color = 'blue';
          songElement.scrollIntoView({ block: "center" });
          const currentSong = songElement.innerHTML;
          const currentSongElement = document.getElementById('current-song');
          if (currentSongElement) currentSongElement.innerHTML = 'Current song: ' + currentSong;
        }

        const lastSongElement = document.getElementById('song-' + lastSongIndex);
        if (lastSongElement) lastSongElement.style.color = 'black';
        lastSongIndex = currentSongIndex;
      }

      const currentVolumeElement = document.getElementById('current-volume');
      if (currentVolumeElement) currentVolumeElement.innerHTML = 'Current volume: ' + currentVolume;
    };

    const handleSongClick = async (index, element) => {
      const response = await fetch('/play/' + index);
      const { currentSongIndex, currentVolume } = await response.json();
      updateCurrentInfo(currentSongIndex, currentVolume);
    }

    const handleVolumeClick = async (volume) => {
      const response = await fetch('/volume/' + volume);
      const { currentSongIndex, currentVolume } = await response.json();
      updateCurrentInfo(currentSongIndex, currentVolume);
    };

    const handleClick = async (path) => {
      const response = await fetch('/' + path);
      const { currentSongIndex, currentVolume } = await response.json();
      updateCurrentInfo(currentSongIndex, currentVolume);
    };

    const getInfo = async () => {
      const response = await fetch('/info');
      const { currentSongIndex, currentVolume } = await response.json();
      updateCurrentInfo(currentSongIndex, currentVolume);
    };

    getInfo();
  </script>

  <div style="position: fixed; background-color: lightgrey">
    <div id="current-song">Current song: </div>
    <div id="current-volume">Current volume: </div>
    <button onclick="handleClick('play')">PLAY</button>
    <button onclick="handleClick('stop')">STOP</button>
    <button onclick="handleClick('random')">RANDOM</button>
    <button onclick="handleClick('next')">NEXT</button>
    <button onclick="handleClick('previous')">PREVIOUS</button>
    <button onclick="handleVolumeClick(0)">Volume 0%</button>
    <button onclick="handleVolumeClick(10)">Volume 10%</button>
    <button onclick="handleVolumeClick(20)">Volume 20%</button>
    <button onclick="handleVolumeClick(30)">Volume 30%</button>
    <button onclick="handleVolumeClick(40)">Volume 40%</button>
    <button onclick="handleVolumeClick(50)">Volume 50%</button>
    <button onclick="handleVolumeClick(60)">Volume 60%</button>
    <button onclick="handleVolumeClick(70)">Volume 70%</button>
    <button onclick="handleVolumeClick(80)">Volume 80%</button>
    <button onclick="handleVolumeClick(90)">Volume 90%</button>
    <button onclick="handleVolumeClick(100)">Volume 100%</button>
  </div>

  <div style="height: 100px;"></div>

  ${filePaths
    .map(
      (filePath, index) =>
        `<div onClick="handleSongClick(${index})" style="cursor: pointer;" id="song-${index}">${filePath.replace(
          `${SOURCE_PATH}/`,
          ""
        )}</div>`
    )
    .join("\n<hr />\n")}
  </body>
</html>`;

const stopSong = () => {
  if (currentController) {
    console.log("🟥 STOP SONG");
    currentController.abort();
  }
};

const startSong = async () => {
  stopSong();

  currentController = new AbortController();

  const filePath = filePaths[currentSongIndex];

  console.log(`🟢 START SONG: ${filePath}`);

  try {
    await runCommand(getPlayerCommand(filePath), currentController.signal);
  } catch (error) {
    // user set a new song
    return;
  }

  // run next song
  currentController = null;
  currentSongIndex = currentSongIndex + 1;
  startSong();
};

const setVolume = async () => {
  console.log("🟡 SET VOLUME", currentVolume);
  await runCommand(getVolumeCommand(currentVolume));
};

const app = express();

app.get("/", (_, res) => {
  res.send(getPage());
});

app.get("/volume/:volume", async (req, res) => {
  currentVolume = Number(req.params.volume);
  console.log("🔷 VOLUME REQUEST", currentVolume);
  await setVolume();
  res.send({ currentSongIndex, currentVolume });
});

app.get("/play/:songIndex", (req, res) => {
  currentSongIndex = Number(req.params.songIndex);
  console.log("🔵 PLAY SONG REQUEST", currentSongIndex);
  // we don't wait for the song end here
  startSong();
  res.send({ currentSongIndex, currentVolume });
});

app.get("/play", (_req, res) => {
  console.log("🔵 PLAY REQUEST", currentSongIndex);
  // we don't wait for the song end here
  startSong();
  res.send({ currentSongIndex, currentVolume });
});

app.get("/stop", (_req, res) => {
  console.log("🟦 STOP REQUEST");
  stopSong();
  res.send({ currentSongIndex, currentVolume });
});

app.get("/random", (_req, res) => {
  currentSongIndex = Math.floor(Math.random() * filePaths.length);
  console.log("🔵 RANDOM REQUEST", currentSongIndex);
  // we don't wait for the song end here
  startSong();
  res.send({ currentSongIndex, currentVolume });
});

app.get("/next", (_req, res) => {
  currentSongIndex = currentSongIndex + 1;
  console.log("🔵 NEXT REQUEST", currentSongIndex);
  // we don't wait for the song end here
  startSong();
  res.send({ currentSongIndex, currentVolume });
});

app.get("/previous", (_req, res) => {
  currentSongIndex = currentSongIndex - 1;
  console.log("🔵 PREVIOUS REQUEST", currentSongIndex);
  // we don't wait for the song end here
  startSong();
  res.send({ currentSongIndex, currentVolume });
});

app.get("/info", (_req, res) => {
  console.log("🔵 INFO REQUEST", currentSongIndex);
  res.send({ currentSongIndex, currentVolume });
});

app.listen(PORT, () => {
  console.log(`App listening on port ${PORT}`);
});
