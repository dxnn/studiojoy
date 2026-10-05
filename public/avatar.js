// An avatar, drawn (ideas/dreams.md §6): a head over a body over legs, each a
// piece of gear's picture or, where nothing is worn, the bare shape
// (public/gear-shapes.js). The whole figure in the wardrobe and on a person;
// the head alone where there is only room for a face — a chat message, a row
// of the crew, your own name.

import { h } from './dom.js';
import { SLOTS, shapeSvg } from './gear-shapes.js';

const BARE = '#5b5486';
const bare = new Map();
const bareOf = (slot) => {
  if (!bare.has(slot)) bare.set(slot, shapeSvg(slot, BARE));
  return bare.get(slot);
};

export const gearSrc = (id) => `/api/gear/${id}/picture`;

// One slot: the piece worn, over the bare shape — so a piece with gaps in it
// still has a body showing through them — or the bare shape alone.
const part = (avatar, slot, cls) => h('img', {
  class: cls,
  src: avatar?.[slot] ? gearSrc(avatar[slot]) : bareOf(slot),
  style: avatar?.[slot] ? `background-image:url("${bareOf(slot)}")` : null,
  alt: '',
});

export const avatarFigure = (avatar, { size = 'big' } = {}) => h('div', { class: `avatar-figure ${size}` },
  ...SLOTS.map((slot) => part(avatar, slot, slot)));

export const avatarHead = (avatar) => part(avatar, 'head', 'avatar-head');

// Somebody in the studio's avatar, by account: yours from S.me, everybody
// else's from the crew list.
export const avatarOf = (S, userId) => (userId === S.me?.id
  ? S.me.avatar
  : S.people.find((p) => p.id === userId)?.avatar) ?? null;
