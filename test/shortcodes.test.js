// Emoji shortcodes: what a message says once it is sent (public/shortcodes.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHORTCODES, withEmoji } from '../public/shortcodes.js';

test('a known name becomes its emoji, wherever it sits between words', () => {
  assert.equal(withEmoji(':wave: hello'), '👋 hello');
  assert.equal(withEmoji('well done :tada::tada:'), 'well done 🎉🎉');
  assert.equal(withEmoji('yes (:+1:) and no :-1:.'), 'yes (👍) and no 👎.');
  assert.equal(withEmoji(':Wave: from a phone'), '👋 from a phone', 'any case');
});

test('anything else between colons is left as it was typed', () => {
  assert.equal(withEmoji('see you at 10:30:45'), 'see you at 10:30:45');
  assert.equal(withEmoji('a ratio of 1:100:1'), 'a ratio of 1:100:1');
  assert.equal(withEmoji('lol:joy:'), 'lol:joy:', 'a word against it');
  assert.equal(withEmoji(':not_an_emoji_at_all:'), ':not_an_emoji_at_all:');
  // A plain object answers these with what it inherits.
  assert.equal(withEmoji(':constructor: :__proto__: :tostring:'), ':constructor: :__proto__: :tostring:');
});

test('code in backticks is meant character for character', () => {
  assert.equal(withEmoji('try `a:x:b` and `:fire:` :fire:'), 'try `a:x:b` and `:fire:` 🔥');
  assert.equal(withEmoji('```\nconst s = ":wave:";\n```\n:wave:'), '```\nconst s = ":wave:";\n```\n👋');
});

test('the list is the thousand most used, every name one the pattern can match', () => {
  const names = Object.keys(SHORTCODES);
  assert.equal(new Set(Object.values(SHORTCODES)).size, 1000);
  for (const name of names) {
    assert.match(name, /^[a-z0-9_+-]+$/, name);
    assert.equal(withEmoji(`:${name}:`), SHORTCODES[name], name);
  }
});
