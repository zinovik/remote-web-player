#!/usr/bin/env node

const { exec } = require("child_process");
const fs = require("fs");
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
  page: "",
  currentController: null,
  currentSongIndex: 0,
  currentVolume: null,
};

const getTimeAndGenre = (path) => {
  return new Promise((resolve) =>
    musicMetadata
      .parseFile(path)
      .then((metadata) =>
        resolve({
          genre: (metadata.common.genre || []).join("/"),
          duration:
            String(Math.floor((metadata.format.duration || 0) / 60)) +
            ":" +
            String(Math.round((metadata.format.duration || 0) % 60)).padStart(
              2,
              "0"
            ),
        })
      )
      .catch(() => {
        console.warn(
          `${new Date().toISOString()}: Error reading metadata`,
          path
        );
        resolve({
          genre: "unknown",
          duration: 0,
        });
      })
  );
};

(async () => {
  const treeOutput = await runCommand(`tree ${SOURCE_PATH} -f`);

  console.log(`${new Date().toISOString()}: Scanning music collection...`);

  globalMutableState.files = await Promise.all(
    treeOutput
      .split("\n")
      .filter((filePath) => filePath.endsWith(".mp3"))
      .map(async (filePath) => {
        const path = filePath.substring(filePath.indexOf(SOURCE_PATH));
        const filename = path.replace(`${SOURCE_PATH}/`, "");
        const [artist, yearAndAlbum, trackAndTitle] = filename.split("/");
        const year = yearAndAlbum.substring(0, 4);
        const album = yearAndAlbum.substring(7, yearAndAlbum.length);
        const track = trackAndTitle.substring(0, 2);
        const title = trackAndTitle
          .substring(5, trackAndTitle.length)
          .replace(".mp3", "");

        return {
          path,
          artist,
          year,
          album,
          track,
          title,
          isFirstAlbumSong: track === "01",
          ...(await getTimeAndGenre(path)),
        };
      })
  );

  console.log(`${new Date().toISOString()}: Scanning done`);

  globalMutableState.page = fs
    .readFileSync(`${__dirname}/index.html`)
    .toString()
    .replace(
      "<div>SONG LIST PLACEHOLDER</div>",
      globalMutableState.files
        .map(
          (
            {
              artist,
              year,
              album,
              track,
              title,
              duration,
              genre,
              isFirstAlbumSong,
            },
            index
          ) => {
            let result = "";

            if (isFirstAlbumSong)
              result += `<hr /><div>${artist} - ${album} (${year})</div><div>${genre}</div><hr />`;

            result += `<div onClick="handleSongClick(${index})" style="cursor: pointer;" id="song-${index}">${duration} | ${track} - ${title}</div>`;

            return result;
          }
        )
        .join("")
    )
    .replace(
      "const files = [];",
      `const files = ${JSON.stringify(
        globalMutableState.files.map((file) => {
          const { path, ...rest } = file;
          return rest;
        })
      )};`
    );

  const url = await ngrok.connect({ addr: PORT });
  console.log(`${new Date().toISOString()}: ${url}`);
})();

const stopSong = () => {
  if (!globalMutableState.currentController) return;

  console.log(`${new Date().toISOString()}: 🟥 STOP SONG`);
  globalMutableState.currentController.abort();
};

const startSong = async () => {
  stopSong();

  globalMutableState.currentController = new AbortController();

  const filePath =
    globalMutableState.files[globalMutableState.currentSongIndex].path;

  console.log(`${new Date().toISOString()}: 🟢 START SONG: ${filePath}`);

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
  console.log(
    `${new Date().toISOString()}: 🟡 SET VOLUME`,
    globalMutableState.currentVolume
  );
  await runCommand(getVolumeCommand(globalMutableState.currentVolume));
};

const app = express();

app.get("/", (_, res) => {
  res.send(globalMutableState.page);
});

app.get("/volume/:volume", async (req, res) => {
  globalMutableState.currentVolume = Number(req.params.volume);
  console.log(
    `${new Date().toISOString()}: 🔷 VOLUME REQUEST`,
    globalMutableState.currentVolume
  );
  await setVolume();
  res.send({
    currentSongIndex: globalMutableState.currentSongIndex,
    currentVolume: globalMutableState.currentVolume,
  });
});

app.get("/play/:songIndex", (req, res) => {
  globalMutableState.currentSongIndex = Number(req.params.songIndex);
  console.log(
    `${new Date().toISOString()}: 🔵 PLAY SONG REQUEST`,
    globalMutableState.currentSongIndex
  );
  // we don't wait for the song end here
  startSong();
  res.send({
    currentSongIndex: globalMutableState.currentSongIndex,
    currentVolume: globalMutableState.currentVolume,
  });
});

app.get("/play", (_req, res) => {
  console.log(
    `${new Date().toISOString()}: 🔵 PLAY REQUEST`,
    globalMutableState.currentSongIndex
  );
  // we don't wait for the song end here
  startSong();
  res.send({
    currentSongIndex: globalMutableState.currentSongIndex,
    currentVolume: globalMutableState.currentVolume,
  });
});

app.get("/stop", (_req, res) => {
  console.log(`${new Date().toISOString()}: 🟦 STOP REQUEST`);
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
  console.log(
    `${new Date().toISOString()}: 🔵 RANDOM REQUEST`,
    globalMutableState.currentSongIndex
  );
  // we don't wait for the song end here
  startSong();
  res.send({
    currentSongIndex: globalMutableState.currentSongIndex,
    currentVolume: globalMutableState.currentVolume,
  });
});

app.get("/next", (_req, res) => {
  globalMutableState.currentSongIndex = globalMutableState.currentSongIndex + 1;
  console.log(
    `${new Date().toISOString()}: 🔵 NEXT REQUEST`,
    globalMutableState.currentSongIndex
  );
  // we don't wait for the song end here
  startSong();
  res.send({
    currentSongIndex: globalMutableState.currentSongIndex,
    currentVolume: globalMutableState.currentVolume,
  });
});

app.get("/previous", (_req, res) => {
  globalMutableState.currentSongIndex = globalMutableState.currentSongIndex - 1;
  console.log(
    `${new Date().toISOString()}: 🔵 PREVIOUS REQUEST`,
    globalMutableState.currentSongIndex
  );
  // we don't wait for the song end here
  startSong();
  res.send({
    currentSongIndex: globalMutableState.currentSongIndex,
    currentVolume: globalMutableState.currentVolume,
  });
});

app.get("/info", (_req, res) => {
  console.log(`${new Date().toISOString()}: 🔵 INFO REQUEST`);
  res.send({
    currentSongIndex: globalMutableState.currentSongIndex,
    currentVolume: globalMutableState.currentVolume,
  });
});

app.listen(PORT, () => {
  console.log(`${new Date().toISOString()}: App listening on port ${PORT}`);
});
