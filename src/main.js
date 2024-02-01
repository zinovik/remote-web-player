#!/usr/bin/env node

const { exec } = require("child_process");
const { promisify } = require("util");
const express = require("express");
const ngrok = require("ngrok");
const musicMetadata = require("music-metadata");

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

const globalMutableState = {
  files: [],
  currentController: null,
  currentSongIndex: 0,
  currentVolume: null,
};

const getTimeAndGenre = (path) => {
  return new Promise((resolve, reject) =>
    musicMetadata
      .parseFile(path)
      .then((metadata) =>
        resolve({
          genre: (metadata.common.genre || []).join(", "),
          duration:
            String(Math.floor((metadata.format.duration || 0) / 60)) +
            ":" +
            String(Math.round((metadata.format.duration || 0) % 60)).padStart(
              2,
              "0"
            ),
        })
      )
      .catch(() =>
        resolve({
          genre: "unknown",
          duration: 0,
        })
      )
  );
};

(async () => {
  const treeOutput = await runCommand(`tree ${SOURCE_PATH} -f`);

  console.log("Scanning music collection...");

  globalMutableState.files = await Promise.all(
    treeOutput
      .split("\n")
      .filter((filePath) => filePath.endsWith(".mp3"))
      .map(async (filePath) => {
        const path = filePath.substring(filePath.indexOf(SOURCE_PATH));
        const filename = path.replace(`${SOURCE_PATH}/`, "");
        const [artist, yearAndAlbum, song] = filename.split("/");
        const year = yearAndAlbum.substring(0, 4);
        const album = yearAndAlbum.substring(6, yearAndAlbum.length);
        const songNumber = song.substring(0, 2);

        return {
          path,
          artist,
          year,
          album,
          song: song.replace(".mp3", ""),
          isFirstAlbumSong: songNumber === "01",
          ...(await getTimeAndGenre(path)),
        };
      })
  );

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

    const scrollToTheCurrentSong = (songElement) => {
      (songElement || document.getElementById('song-' + lastSongIndex)).scrollIntoView({ block: "center" });
    };

    const updateCurrentInfo = (currentSongIndex, currentVolume) => {
      if (currentSongIndex !== lastSongIndex) {
        const songElement = document.getElementById('song-' + currentSongIndex);
        if (songElement) {
          songElement.style.color = 'blue';
          scrollToTheCurrentSong(songElement);
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

    setTimeout(() => getInfo(), 1000);
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
    <button onclick="scrollToTheCurrentSong()">Scroll to the current song</button>
  </div>

  <div style="height: 170px;"></div>

  ${globalMutableState.files
    .map(
      (
        { artist, year, album, song, duration, genre, isFirstAlbumSong },
        index
      ) => {
        const results = [];

        if (isFirstAlbumSong) {
          results.push(
            `<hr /><div>${artist}</div><div>${album}</div><div>${year}</div><div>${genre}</div><hr />`
          );
        }

        results.push(
          `<div onClick="handleSongClick(${index})" style="cursor: pointer;" id="song-${index}">${duration} | ${song}</div>`
        );

        return results.join("");
      }
    )
    .join("")}
  </body>
</html>`;

const stopSong = () => {
  if (globalMutableState.currentController) {
    console.log("🟥 STOP SONG");
    globalMutableState.currentController.abort();
  }
};

const startSong = async () => {
  stopSong();

  globalMutableState.currentController = new AbortController();

  const filePath =
    globalMutableState.files[globalMutableState.currentSongIndex].path;

  console.log(`🟢 START SONG: ${filePath}`);

  try {
    await runCommand(
      getPlayerCommand(filePath),
      globalMutableState.currentController.signal
    );
  } catch (error) {
    // user set a new song
    return;
  }

  // run next song
  globalMutableState.currentController = null;
  globalMutableState.currentSongIndex = globalMutableState.currentSongIndex + 1;
  startSong();
};

const setVolume = async () => {
  console.log("🟡 SET VOLUME", globalMutableState.currentVolume);
  await runCommand(getVolumeCommand(globalMutableState.currentVolume));
};

const app = express();

app.get("/", (_, res) => {
  res.send(getPage());
});

app.get("/volume/:volume", async (req, res) => {
  globalMutableState.currentVolume = Number(req.params.volume);
  console.log("🔷 VOLUME REQUEST", globalMutableState.currentVolume);
  await setVolume();
  res.send({
    currentSongIndex: globalMutableState.currentSongIndex,
    currentVolume: globalMutableState.currentVolume,
  });
});

app.get("/play/:songIndex", (req, res) => {
  globalMutableState.currentSongIndex = Number(req.params.songIndex);
  console.log("🔵 PLAY SONG REQUEST", globalMutableState.currentSongIndex);
  // we don't wait for the song end here
  startSong();
  res.send({
    currentSongIndex: globalMutableState.currentSongIndex,
    currentVolume: globalMutableState.currentVolume,
  });
});

app.get("/play", (_req, res) => {
  console.log("🔵 PLAY REQUEST", globalMutableState.currentSongIndex);
  // we don't wait for the song end here
  startSong();
  res.send({
    currentSongIndex: globalMutableState.currentSongIndex,
    currentVolume: globalMutableState.currentVolume,
  });
});

app.get("/stop", (_req, res) => {
  console.log("🟦 STOP REQUEST");
  stopSong();
  res.send({
    currentSongIndex: globalMutableState.currentSongIndex,
    currentVolume: globalMutableState.currentVolume,
  });
});

app.get("/random", (_req, res) => {
  globalMutableState.currentSongIndex = Math.floor(
    Math.random() * globalMutableState.files.length
  );
  console.log("🔵 RANDOM REQUEST", globalMutableState.currentSongIndex);
  // we don't wait for the song end here
  startSong();
  res.send({
    currentSongIndex: globalMutableState.currentSongIndex,
    currentVolume: globalMutableState.currentVolume,
  });
});

app.get("/next", (_req, res) => {
  globalMutableState.currentSongIndex = globalMutableState.currentSongIndex + 1;
  console.log("🔵 NEXT REQUEST", globalMutableState.currentSongIndex);
  // we don't wait for the song end here
  startSong();
  res.send({
    currentSongIndex: globalMutableState.currentSongIndex,
    currentVolume: globalMutableState.currentVolume,
  });
});

app.get("/previous", (_req, res) => {
  globalMutableState.currentSongIndex = globalMutableState.currentSongIndex - 1;
  console.log("🔵 PREVIOUS REQUEST", globalMutableState.currentSongIndex);
  // we don't wait for the song end here
  startSong();
  res.send({
    currentSongIndex: globalMutableState.currentSongIndex,
    currentVolume: globalMutableState.currentVolume,
  });
});

app.get("/info", (_req, res) => {
  console.log("🔵 INFO REQUEST", globalMutableState.currentSongIndex);
  res.send({
    currentSongIndex: globalMutableState.currentSongIndex,
    currentVolume: globalMutableState.currentVolume,
  });
});

app.listen(PORT, () => {
  console.log(`App listening on port ${PORT}`);
});
