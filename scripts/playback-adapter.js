const AY_CHANNELS = Object.freeze(['A', 'B', 'C']);

export function createPlaybackAdapter({ ayHandle, psgHandle, beeperHandle, effectHandle } = {}) {
  const channelHandles = [ayHandle, psgHandle, effectHandle].filter(Boolean);
  if (channelHandles.length > 1) {
    throw new TypeError('createPlaybackAdapter: expected only one AY, PSG, or effect handle');
  }

  const channelHandle = channelHandles[0] ?? null;
  let stopped = false;

  function setChannelGain(channel, gain, rampMs) {
    if (stopped) return;

    if (channel === 'BEEPER') {
      beeperHandle?.setGain(gain, rampMs);
      return;
    }

    if (AY_CHANNELS.includes(channel)) channelHandle?.setChannelGain(channel, gain, rampMs);
  }

  function setStereoMode(mode) {
    if (stopped) return;
    if (ayHandle) ayHandle.setStereoMode(mode);
    else if (psgHandle) psgHandle.setStereo(mode);
  }

  function stop() {
    if (stopped) return;
    stopped = true;

    let firstError;
    const ownedHandles = new Set([ayHandle, psgHandle, beeperHandle, effectHandle].filter(Boolean));
    for (const handle of ownedHandles) {
      try {
        handle.stop();
      } catch (error) {
        firstError ??= error;
      }
    }

    if (firstError) throw firstError;
  }

  return Object.freeze({ setChannelGain, setStereoMode, stop });
}
