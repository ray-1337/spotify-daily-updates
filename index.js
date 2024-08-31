require("dotenv/config");

const ms = require("ms");
const path = require("node:path");
const { existsSync } = require("node:fs");
const { stat, readFile, writeFile } = require("node:fs/promises");

const { getShuffledArray } = require("./util");

const clientId = process.env.CLIENT_ID;
const clientSecret = process.env.CLIENT_SECRET;
const ownerId = process.env.OWNER_ID;
const preferredPlaylistId = process.env.PREFERRED_PLAYLIST_ID; // playlist ID you want to change
if (!clientId || !clientSecret || !ownerId || !preferredPlaylistId) {
  throw "Invalid secret content.";
};

const tokenPath = path.join(__dirname, "token");
if (!existsSync(tokenPath)) {
  throw new Error('Token must be generated through Auth Code Flow. \nAuthorize, create a file named "token", and merge the access and refresh token by ":". \nExample: ACCESSTOKEN:REFRESHTOKEN \n');
};

let token = null; // temporarily in memory

async function refreshToken() {
  token = null;

  const tokenContent = await readFile(tokenPath, { encoding: "utf-8" });
  if (!tokenContent?.length) {
    throw "Invalid token content.";
  };

  const [secretToken, refreshToken] = tokenContent.split(":");
  if (!secretToken || !refreshToken) {
    throw "Invalid secret or refresh token.";
  };

  const req = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",

    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId
    })
  });

  const data = await req.json();

  if (!data || typeof data?.access_token !== "string") {
    throw `No access or refresh token after post, received ${req.status}`;
  };

  token = data.access_token;

  const arrangement = `${data.access_token}:${data?.refresh_token || refreshToken}`;

  await writeFile(tokenPath, arrangement);

  return;
};

async function init() {
  const tokenFileStats = await stat(tokenPath);
  if (!tokenFileStats) {
    throw 'Unable to check "token" file stats.';
  };
  
  const lastModifiedTokenFile = tokenFileStats.mtime.getTime();
  if ((Date.now() - lastModifiedTokenFile) >= ms("1h")) {
    await refreshToken();
  } else {
    if (!token) {
      const tokenContent = await readFile(tokenPath, { encoding: "utf-8" });
      if (!tokenContent?.length) {
        throw "Invalid token content.";
      };

      const [secretToken] = tokenContent.split(":");
      if (!secretToken) {
        throw "Invalid secret or refresh token.";
      };
      
      token = secretToken;
    };
  };

  if (!token) {
    throw "Token still 'null' after request or file check.";
  };

  // i have bunch of playlists, pardon me
  const playlistsReq = await fetch("https://api.spotify.com/v1/me/playlists?limit=50", {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`
    }
  });

  const playlists = await playlistsReq.json();
  if (!playlists || !Array.isArray(playlists?.items)) {
    throw `Unable to fetch playlist items. Status code: ${playlistsReq.status}`;
  };

  const filteredItems = playlists.items.filter(item => item.type === "playlist" && item.owner.id === ownerId);

  const shuffledItems = getShuffledArray(filteredItems);

  let finalUriIDs = [];

  for (const playlist of shuffledItems.slice(0, 5)) {
    const filterString = "items(track(id))"; // i just want the ID
    const itemsReq = await fetch(`https://api.spotify.com/v1/playlists/${playlist.id}/tracks?market=ID&fields=${filterString}&limit=50`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`
      }
    });

    const itemsJson = await itemsReq.json();
    if (!itemsJson || !Array.isArray(itemsJson?.items)) {
      throw `Unable to fetch items inside the playlist. Status code: ${itemsReq.status}`;
    };

    const shuffledTracks = getShuffledArray(itemsJson.items);
    const slicedTracks = shuffledTracks.slice(0, 10);

    finalUriIDs = finalUriIDs.concat(slicedTracks.map(item => item.track.id));

    await new Promise(r => setTimeout(r, ms("5s")));

    continue;
  };

  if (!finalUriIDs?.length) {
    throw "No URI IDs available after creation.";
  };

  const shuffledFinalUriIDs = getShuffledArray(finalUriIDs);

  const updatePlaylistReq = await fetch(`https://api.spotify.com/v1/playlists/${preferredPlaylistId}/tracks`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify({
      uris: shuffledFinalUriIDs.map((uriId) => `spotify:track:${uriId}`)
    })
  });

  if (updatePlaylistReq.status !== 200) {
    const content = await updatePlaylistReq.json();
    console.error(content);

    throw `Unable to make changes to the playlist. Status code: ${updatePlaylistReq.status}`;
  };

  const currentTime = new Date();

  console.log(`Playlist updated at [${currentTime.toLocaleString()} | ${currentTime.getTime()}]`);

  return;
};

init();