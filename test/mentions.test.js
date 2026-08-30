import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMentions, agentEligible } from '../server/mentions.js';

const eligible = (name, body, chatty = false) =>
  agentEligible({ name, chatty }, parseMentions(body));

test('parseMentions normalises to lowercase alphanumerics', () => {
  assert.deepEqual([...parseMentions('hey @Designer')], ['designer']);
  assert.deepEqual([...parseMentions('@Level-Designer')], ['leveldesigner']);
  assert.deepEqual([...parseMentions('@a_b_c')], ['abc']);
  assert.deepEqual([...parseMentions('@one and @two')].sort(), ['one', 'two']);
  // Duplicates collapse.
  assert.deepEqual([...parseMentions('@x @x @X')], ['x']);
});

test('parseMentions finds nothing where there is nothing', () => {
  for (const body of ['', 'no mentions here', '@', '@@', null, undefined, 42]) {
    assert.deepEqual([...parseMentions(body)], [], JSON.stringify(body));
  }
});

// An address in a message would otherwise wake anything named Example.
test('an email address is not a mention', () => {
  assert.deepEqual([...parseMentions('mail dann@example.com about it')], []);
  assert.deepEqual([...parseMentions('a@b.com')], []);
  // But a mention right after punctuation still counts.
  assert.deepEqual([...parseMentions('(@designer) thoughts?')], ['designer']);
  assert.deepEqual([...parseMentions('@designer at the start')], ['designer']);
  assert.deepEqual([...parseMentions('hey,@designer')], ['designer']);
});

test('a mention matches the whole normalised name', () => {
  assert.equal(eligible('Level Designer', 'ping @leveldesigner'), true);
  assert.equal(eligible('Level Designer', 'ping @Level-Designer'), true);
  assert.equal(eligible('Level Designer', 'ping @LEVELDESIGNER'), true);
});

test('a mention matches a prefix of at least two characters', () => {
  assert.equal(eligible('Level Designer', 'ping @level'), true);
  assert.equal(eligible('Level Designer', 'ping @le'), true);
  assert.equal(eligible('Level Designer', 'ping @l'), false, 'one letter is too loose');
  assert.equal(eligible('Level Designer', 'ping @designer'), false, 'not a prefix');
});

test('a single-character name is still mentionable exactly', () => {
  assert.equal(eligible('Q', 'ping @q'), true);
  assert.equal(eligible('Q', 'ping @qq'), false);
});

test('a chatty agent needs no mention', () => {
  assert.equal(eligible('Designer', 'nothing addressed to anyone', true), true);
  assert.equal(eligible('Designer', 'nothing addressed to anyone', false), false);
});

test('one mention can wake several agents by shared prefix', () => {
  const mentions = parseMentions('@level what do you both think?');
  assert.equal(agentEligible({ name: 'Level Designer' }, mentions), true);
  assert.equal(agentEligible({ name: 'Level Critic' }, mentions), true);
  assert.equal(agentEligible({ name: 'Sound Designer' }, mentions), false);
});

test('an unnameable agent is never eligible by mention', () => {
  assert.equal(eligible('...', 'ping @anything'), false);
  assert.equal(eligible('', 'ping @anything'), false);
});
