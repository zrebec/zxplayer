export const CHANNELS = Object.freeze(['A', 'B', 'C', 'BEEPER']);

export function createChannelMixer({ availability = {} } = {}) {
  const muted = Object.fromEntries(CHANNELS.map((channel) => [channel, false]));
  const volumes = Object.fromEntries(CHANNELS.map((channel) => [channel, 1]));
  const available = Object.fromEntries(
    CHANNELS.map((channel) => [channel, availability[channel] === undefined ? true : Boolean(availability[channel])]),
  );
  let soloChannel = null;

  function isKnownChannel(channel) {
    return CHANNELS.includes(channel);
  }

  function isAudible(channel) {
    if (!isKnownChannel(channel) || !available[channel]) return false;
    if (soloChannel !== null) return channel === soloChannel;
    return !muted[channel];
  }

  function getChannelState(channel) {
    if (!isKnownChannel(channel)) return null;

    return Object.freeze({
      available: available[channel],
      muted: muted[channel],
      solo: soloChannel === channel,
      audible: isAudible(channel),
      volume: volumes[channel],
    });
  }

  function getState() {
    const channels = Object.fromEntries(CHANNELS.map((channel) => [channel, getChannelState(channel)]));

    return Object.freeze({
      soloChannel,
      channels: Object.freeze(channels),
    });
  }

  function toggleMute(channel) {
    if (!isKnownChannel(channel) || !available[channel]) return getState();

    if (soloChannel === channel) {
      soloChannel = null;
      muted[channel] = true;
    } else {
      muted[channel] = !muted[channel];
    }

    return getState();
  }

  function toggleSolo(channel) {
    if (!isKnownChannel(channel) || !available[channel]) return getState();

    soloChannel = soloChannel === channel ? null : channel;
    return getState();
  }

  function setAvailability(nextAvailability) {
    if (!nextAvailability || typeof nextAvailability !== 'object') return getState();

    for (const channel of CHANNELS) {
      if (Object.hasOwn(nextAvailability, channel)) {
        available[channel] = Boolean(nextAvailability[channel]);
      }
    }

    if (soloChannel !== null && !available[soloChannel]) soloChannel = null;
    return getState();
  }

  function setVolume(channel, value) {
    if (!isKnownChannel(channel) || typeof value !== 'number' || !Number.isFinite(value)) return getState();

    volumes[channel] = Math.min(1, Math.max(0, value));
    return getState();
  }

  function resetVolumes() {
    for (const channel of CHANNELS) volumes[channel] = 1;
    return getState();
  }

  return Object.freeze({
    getChannelState,
    getState,
    isAudible,
    resetVolumes,
    setAvailability,
    setVolume,
    toggleMute,
    toggleSolo,
  });
}
