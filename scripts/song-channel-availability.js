const AY_CHANNELS = ['A', 'B', 'C'];
const BEEPER_CHANNEL = 'BEEPER';

export function getSongChannelAvailability(song) {
  if (song?.effect === 'ambulance') return [...AY_CHANNELS];

  const available = AY_CHANNELS.filter((channel) => channelHasAudibleArrangement(song?.channels?.[channel], false));
  if (channelHasAudibleArrangement(song?.beeper, true)) available.push(BEEPER_CHANNEL);
  return available;
}

export function songHasAudibleAY(song) {
  return AY_CHANNELS.some((channel) => channelHasAudibleArrangement(song?.channels?.[channel], false));
}

export function songUsesAYArrangement(song) {
  return song?.effect !== 'ambulance';
}

export function describeReadyChannels(channels) {
  const available = new Set(channels);
  const ayChannels = AY_CHANNELS.filter((channel) => available.has(channel));
  const hasBeeper = available.has(BEEPER_CHANNEL);

  if (ayChannels.length === 0 && !hasBeeper) {
    return 'Pripravené, ale skladba neobsahuje žiadny počuteľný kanál.';
  }
  if (ayChannels.length === 0 && hasBeeper) return 'Pripravené. PLAY spustí samostatnú beeper stopu.';
  if (ayChannels.length === 3 && hasBeeper) {
    return 'Pripravené. PLAY spustí tri AY kanály a samostatnú beeper stopu.';
  }
  if (ayChannels.length === 3) return 'Pripravené. PLAY odomkne AudioContext a spustí všetky tri AY kanály.';

  const ayLabel = ayChannels.length === 1 ? `AY kanál ${ayChannels[0]}` : `AY kanály ${joinChannels(ayChannels)}`;
  const beeperLabel = hasBeeper ? `${ayChannels.length > 0 ? ' a' : ''} samostatnú beeper stopu` : '';
  return `Pripravené. PLAY spustí ${ayLabel}${beeperLabel}.`;
}

function channelHasAudibleArrangement(channel, beeper) {
  if (!channel?.patterns || !Array.isArray(channel.arrangement)) return false;
  return channel.arrangement.some((entry) => patternHasAudibleStep(channel.patterns[entry?.pattern], beeper));
}

function patternHasAudibleStep(pattern, beeper) {
  if (!pattern || typeof pattern !== 'object') return false;

  if (typeof pattern.notes === 'string') {
    const hasPitchedStep = pattern.notes
      .trim()
      .split(/\s+/)
      .some((token) => token && token.split(':', 1)[0] !== 'r');
    if (beeper) return hasPitchedStep;
    return hasPitchedStep || (pattern.options?.noise === true && pattern.options?.vol !== 0);
  }

  if (!Array.isArray(pattern.events)) return false;
  return pattern.events.some((event) => {
    const hasPitchedStep = (typeof event?.note === 'string' && event.note !== 'r') || event?.freq > 0;
    if (beeper) return hasPitchedStep;
    const noise = event?.noise ?? pattern.options?.noise;
    const volume = event?.vol ?? pattern.options?.vol;
    return hasPitchedStep || (noise === true && volume !== 0);
  });
}

function joinChannels(channels) {
  if (channels.length < 2) return channels.join('');
  return `${channels.slice(0, -1).join(', ')} a ${channels.at(-1)}`;
}
