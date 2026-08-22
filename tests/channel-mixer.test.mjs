import assert from 'node:assert/strict';
import test from 'node:test';

import { CHANNELS, createChannelMixer } from '../scripts/channel-mixer.js';

test('starts with every channel available, unmuted, and audible', () => {
  const mixer = createChannelMixer();

  assert.deepEqual(CHANNELS, ['A', 'B', 'C', 'BEEPER']);
  assert.equal(mixer.getState().soloChannel, null);
  for (const channel of CHANNELS) {
    assert.deepEqual(mixer.getChannelState(channel), {
      available: true,
      muted: false,
      solo: false,
      audible: true,
      volume: 1,
    });
  }
});

test('volume is clamped to 0..1 and invalid values are safe no-ops', () => {
  const mixer = createChannelMixer();

  mixer.setVolume('A', 0.35);
  mixer.setVolume('B', -2);
  mixer.setVolume('C', 3);

  assert.equal(mixer.getChannelState('A').volume, 0.35);
  assert.equal(mixer.getChannelState('B').volume, 0);
  assert.equal(mixer.getChannelState('C').volume, 1);

  const state = mixer.getState();
  mixer.setVolume('A', Number.NaN);
  mixer.setVolume('A', Number.POSITIVE_INFINITY);
  mixer.setVolume('A', '0.5');
  mixer.setVolume('D', 0.5);
  assert.deepEqual(mixer.getState(), state);
});

test('volume remains independent from mute, solo, and audibility', () => {
  const mixer = createChannelMixer();

  mixer.setVolume('A', 0.25);
  mixer.toggleMute('A');
  assert.equal(mixer.getChannelState('A').volume, 0.25);
  assert.equal(mixer.isAudible('A'), false);

  mixer.toggleSolo('A');
  assert.equal(mixer.getChannelState('A').volume, 0.25);
  assert.equal(mixer.isAudible('A'), true);

  mixer.toggleSolo('A');
  mixer.setVolume('B', 0);
  assert.equal(mixer.getChannelState('B').muted, false);
  assert.equal(mixer.isAudible('B'), true);
});

test('resetVolumes restores every channel without changing mute, solo, or availability', () => {
  const mixer = createChannelMixer({ availability: { BEEPER: false } });

  mixer.setVolume('A', 0.2);
  mixer.setVolume('B', 0);
  mixer.setVolume('BEEPER', 0.4);
  mixer.toggleMute('A');
  mixer.toggleSolo('C');
  mixer.resetVolumes();

  for (const channel of CHANNELS) assert.equal(mixer.getChannelState(channel).volume, 1);
  assert.equal(mixer.getChannelState('A').muted, true);
  assert.equal(mixer.getState().soloChannel, 'C');
  assert.equal(mixer.getChannelState('BEEPER').available, false);
});

test('mute toggles a non-solo channel', () => {
  const mixer = createChannelMixer();

  mixer.toggleMute('A');
  assert.equal(mixer.getChannelState('A').muted, true);
  assert.equal(mixer.isAudible('A'), false);

  mixer.toggleMute('A');
  assert.equal(mixer.getChannelState('A').muted, false);
  assert.equal(mixer.isAudible('A'), true);
});

test('solo is exclusive, replaces the previous solo, and exits on a second press', () => {
  const mixer = createChannelMixer();

  mixer.toggleSolo('A');
  assert.equal(mixer.getState().soloChannel, 'A');
  assert.deepEqual(
    CHANNELS.filter((channel) => mixer.isAudible(channel)),
    ['A'],
  );

  mixer.toggleSolo('B');
  assert.equal(mixer.getState().soloChannel, 'B');
  assert.deepEqual(
    CHANNELS.filter((channel) => mixer.isAudible(channel)),
    ['B'],
  );

  mixer.toggleSolo('B');
  assert.equal(mixer.getState().soloChannel, null);
  assert.deepEqual(
    CHANNELS.filter((channel) => mixer.isAudible(channel)),
    CHANNELS,
  );
});

test('solo makes its target audible without changing its stored mute', () => {
  const mixer = createChannelMixer();

  mixer.toggleMute('A');
  mixer.toggleSolo('A');

  assert.equal(mixer.getChannelState('A').muted, true);
  assert.equal(mixer.isAudible('A'), true);
  assert.deepEqual(
    CHANNELS.filter((channel) => mixer.isAudible(channel)),
    ['A'],
  );

  mixer.toggleSolo('A');
  assert.equal(mixer.getChannelState('A').muted, true);
  assert.equal(mixer.isAudible('A'), false);
});

test('muting the current solo cancels solo and stores mute', () => {
  const mixer = createChannelMixer();

  mixer.toggleSolo('C');
  mixer.toggleMute('C');

  assert.equal(mixer.getState().soloChannel, null);
  assert.equal(mixer.getChannelState('C').muted, true);
  assert.equal(mixer.isAudible('C'), false);
  assert.deepEqual(
    CHANNELS.filter((channel) => mixer.isAudible(channel)),
    ['A', 'B', 'BEEPER'],
  );
});

test('muting another channel while solo is active preserves that solo', () => {
  const mixer = createChannelMixer();

  mixer.toggleSolo('A');
  mixer.toggleMute('C');

  assert.equal(mixer.getState().soloChannel, 'A');
  assert.equal(mixer.getChannelState('C').muted, true);

  mixer.toggleSolo('A');
  assert.equal(mixer.isAudible('C'), false);
  assert.deepEqual(
    CHANNELS.filter((channel) => mixer.isAudible(channel)),
    ['A', 'B', 'BEEPER'],
  );
});

test('unavailable channels are inaudible and ignore mute and solo actions', () => {
  const mixer = createChannelMixer({ availability: { BEEPER: false } });
  const initialState = mixer.getState();

  mixer.toggleMute('BEEPER');
  mixer.toggleSolo('BEEPER');

  assert.deepEqual(mixer.getState(), initialState);
  assert.deepEqual(mixer.getChannelState('BEEPER'), {
    available: false,
    muted: false,
    solo: false,
    audible: false,
    volume: 1,
  });
});

test('availability updates clear an unavailable solo and preserve explicit mutes', () => {
  const mixer = createChannelMixer();

  mixer.toggleMute('B');
  mixer.toggleSolo('A');
  mixer.setAvailability({ A: false, B: false, BEEPER: false });

  assert.equal(mixer.getState().soloChannel, null);
  assert.equal(mixer.getChannelState('A').available, false);
  assert.equal(mixer.getChannelState('B').available, false);
  assert.equal(mixer.getChannelState('B').muted, true);
  assert.equal(mixer.getChannelState('BEEPER').available, false);

  mixer.setAvailability({ A: true, B: true, BEEPER: true });
  assert.equal(mixer.getChannelState('B').muted, true);
  assert.equal(mixer.isAudible('B'), false);
  assert.equal(mixer.isAudible('A'), true);
  assert.equal(mixer.isAudible('BEEPER'), true);
});

test('unknown channels are safe no-ops', () => {
  const mixer = createChannelMixer();
  const initialState = mixer.getState();

  mixer.toggleMute('D');
  mixer.toggleSolo('D');

  assert.deepEqual(mixer.getState(), initialState);
  assert.equal(mixer.getChannelState('D'), null);
  assert.equal(mixer.isAudible('D'), false);
});
