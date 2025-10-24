const OBSWebSocket = require('obs-websocket-js').default;

async function main() {
  const host = process.env.OBS_HOST || '127.0.0.1';
  const port = Number(process.env.OBS_PORT || 4455);
  const password = process.env.OBS_PASSWORD || '';
  const url = `ws://${host}:${port}`;
  const obs = new OBSWebSocket();
  try {
    console.log('Connecting to', url);
    await obs.connect(url, password || undefined);
    console.log('Connected. Fetching scenes...');
    const res = await obs.call('GetSceneList');
    console.log('Scenes:', res.scenes.map(s=>s.sceneName));
    await obs.disconnect();
    console.log('Disconnected.');
  } catch (e) {
    console.error('Failed:', e && e.message ? e.message : e);
    process.exitCode = 1;
  }
}

main();

