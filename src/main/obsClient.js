const OBSWebSocket = require('obs-websocket-js').default;

class ObsClient {
  constructor() {
    this.obs = new OBSWebSocket();
    this.connected = false;
  }

  async connect(url, password) {
    if (this.connected) return { connected: true };
    try {
      // obs-websocket-js v5 expects a URL string and optional password + identification params
      // Force RPC version 1 for compatibility with OBS v28+ built-in websocket.
      await this.obs.connect(url, password || undefined, { rpcVersion: 1 });
      this.connected = true;
      return { connected: true };
    } catch (err) {
      this.connected = false;
      return { connected: false, error: String(err && err.message || err) };
    }
  }

  async disconnect() {
    try {
      await this.obs.disconnect();
    } catch (_) {}
    this.connected = false;
    return { connected: false };
  }

  async getScenes() {
    if (!this.connected) return { scenes: [], currentProgramSceneName: null };
    try {
      const res = await this.obs.call('GetSceneList');
      return { scenes: res.scenes.map(s => s.sceneName), currentProgramSceneName: res.currentProgramSceneName };
    } catch (e) {
      return { scenes: [], currentProgramSceneName: null, error: String(e && e.message || e) };
    }
  }

  async switchScene(sceneName) {
    if (!this.connected || !sceneName) return { ok: false };
    await this.obs.call('SetCurrentProgramScene', { sceneName });
    return { ok: true };
  }
}

module.exports = { ObsClient };
