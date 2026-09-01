// How config/story.js opens while it still has the story shape: the story as
// a list of scenes, one open at a time, no code in sight. The model reading
// and file writing is story-editor.js; this is the interface.
//
// Two conventions from the rest of the studio. A scene opens *in its row*
// rather than at the foot of the list, and the same click closes it. And what
// lights up is what can be clicked: the whole row opens, not a control on it.
//
// Field edits regenerate the file content in place without a render — the
// same bargain as the config and quiz forms, because a render would replace
// the field under the fingers. Anything that changes the shape renders:
// adding a scene, removing a line, switching what happens after the last one.

import {
  storyText, storyChecks, storyShape, freshKey, renameScene,
} from './story-editor.js';
import { h } from './dom.js';
import { S, render, saveOpenFile, frozen } from './main.js';

function commit(model) {
  S.open.content = storyText(model);
  S.open.dirty = true;
  const save = document.getElementById('save-btn');
  if (save) save.disabled = false;
  const status = document.getElementById('cfg-status');
  if (status) status.textContent = 'Not saved yet';
}

const field = (value, placeholder, onchange) => {
  const input = h('input', { type: 'text', class: 'cfg-text', placeholder, onchange });
  input.value = value;
  return input;
};

// A select over a list of [value, label] pairs, with the current one chosen.
const pick = (options, value, onchange) => h(
  'select', { onchange },
  options.map(([v, label]) => {
    const option = h('option', { value: v, text: label });
    if (v === value) option.selected = true;
    return option;
  }),
);

const filesUnder = (dir, ext) => S.files
  .map((f) => f.path)
  .filter((p) => p.startsWith(`${dir}/`) && (!ext || p.endsWith(ext)))
  .sort();

export function renderStoryForm(model) {
  const { cast, scenes } = model;
  const paths = S.files.map((f) => f.path);
  const checks = storyChecks(model, paths);
  const shape = storyShape(model);
  const problemsFor = (key) => checks.filter((c) => c.where === key);
  const keys = scenes.map((s) => s.key);

  // Every switch anybody sets, so "needs" is a choice among the ones that
  // exist rather than a name to get wrong.
  const switches = [...new Set(
    scenes.flatMap((s) => s.choices.map((c) => c.set)).filter(Boolean),
  )].sort();

  const open = (key) => {
    S.open.scene = S.open.scene === key ? null : key;
    render();
  };

  /* One line of a scene ---------------------------------------------------- */

  const lineRow = (scene, line, at) => {
    const person = cast.find((p) => p.key === line.who);
    return h('div', { class: 'story-line row' },
      pick(
        [['', 'Nobody'], ...cast.map((p) => [p.key, p.name || p.key])],
        line.who,
        (e) => {
          line.who = e.currentTarget.value;
          // A mood belongs to a person: keep it only if the new one has it.
          const moods = cast.find((p) => p.key === line.who)?.moods ?? [];
          if (!moods.includes(line.mood)) line.mood = moods[0] ?? '';
          commit(model);
          render();
        },
      ),
      person
        ? pick(
          [['', 'no picture'], ...person.moods.map((m) => [m, m])],
          line.mood,
          (e) => { line.mood = e.currentTarget.value; commit(model); },
        )
        : null,
      field(line.say, 'What is said', (e) => { line.say = e.currentTarget.value; commit(model); }),
      h('button', {
        class: 'icon tiny', text: '✕', title: 'Remove this line',
        onclick: () => { scene.lines.splice(at, 1); commit(model); render(); },
      }));
  };

  /* One choice out of a scene ---------------------------------------------- */

  // Two lines, not one: the words on the button are what somebody is writing,
  // and on one row with four other controls they were squeezed to about four
  // characters while the wiring took the width.
  const choiceRow = (scene, choice, at) => h('div', { class: 'story-choice' },
    h('div', { class: 'row' },
      field(choice.say, 'What the button says', (e) => {
        choice.say = e.currentTarget.value;
        commit(model);
      }),
      h('button', {
        class: 'icon tiny', text: '✕', title: 'Remove this choice',
        onclick: () => { scene.choices.splice(at, 1); commit(model); render(); },
      })),
    h('div', { class: 'row story-wiring' },
      h('span', { class: 'hint muted', text: 'goes to' }),
      pick(keys.map((k) => [k, k]), choice.go, (e) => {
        choice.go = e.currentTarget.value;
        commit(model);
        render();
      }),
      h('span', { class: 'hint muted', text: 'remembers' }),
      field(choice.set, 'nothing', (e) => {
        choice.set = e.currentTarget.value.trim();
        commit(model);
        render();
      }),
      h('span', { class: 'hint muted', text: 'only if' }),
      pick(
        [['', 'always'], ...switches.map((s) => [s, s])],
        choice.need,
        (e) => { choice.need = e.currentTarget.value; commit(model); render(); },
      )));

  /* What happens after the last line --------------------------------------- */

  const AFTER = [
    ['choices', 'the player chooses'],
    ['go', 'go straight on to'],
    ['end', 'the story ends here'],
  ];

  const afterOf = (scene) => {
    if (scene.choices.length) return 'choices';
    if (scene.go) return 'go';
    return 'end';
  };

  const setAfter = (scene, want) => {
    // The three are exclusive in the file, so switching empties the other two.
    scene.choices = want === 'choices'
      ? [{ say: '', go: keys.find((k) => k !== scene.key) ?? scene.key, set: '', need: '' }]
      : [];
    scene.go = want === 'go' ? (keys.find((k) => k !== scene.key) ?? '') : '';
    commit(model);
    render();
  };

  /* One scene, open -------------------------------------------------------- */

  const sceneBody = (scene) => {
    const after = afterOf(scene);
    const leadingHere = scenes.reduce((n, s) => n
      + (s.go === scene.key ? 1 : 0)
      + s.choices.filter((c) => c.go === scene.key).length, 0);

    return h('div', { class: 'story-open' },
      h('div', { class: 'row' },
        h('span', { class: 'hint muted', text: 'Name' }),
        field(scene.key, 'a short name', (e) => {
          const want = freshKey(e.currentTarget.value, keys.filter((k) => k !== scene.key));
          renameScene(model, scene.key, want);
          S.open.scene = want;
          commit(model);
          render();
        }),
        h('div', { class: 'spacer' }),
        // Reloads the preview straight into this scene, skipping the title
        // screen — the game's own ?scene=, which the template honours.
        h('button', {
          class: 'link tiny', text: 'Try this scene',
          onclick: () => {
            S.tryScene = scene.key;
            S.previewOpen = true;
            S.previewNonce += 1;
            render();
          },
        }),
        h('button', {
          class: 'danger tiny', text: 'Remove',
          title: leadingHere
            ? `${leadingHere} way${leadingHere === 1 ? '' : 's'} in still lead here`
            : 'Remove this scene',
          disabled: leadingHere > 0 || scenes.length < 2,
          onclick: () => {
            model.scenes = scenes.filter((s) => s !== scene);
            S.open.scene = null;
            commit(model);
            render();
          },
        })),

      h('div', { class: 'row' },
        h('span', { class: 'hint muted', text: 'Picture' }),
        pick(
          [['', 'none'], ...filesUnder('assets/images').map((p) => [p, p.split('/').pop()])],
          scene.picture,
          (e) => { scene.picture = e.currentTarget.value; commit(model); render(); },
        ),
        h('span', { class: 'hint muted', text: 'Sound' }),
        pick(
          [['', 'none'], ...filesUnder('assets/sounds', '.wav')
            .map((p) => [p.slice('assets/sounds/'.length, -4), p.split('/').pop()])],
          scene.sound,
          (e) => { scene.sound = e.currentTarget.value; commit(model); render(); },
        )),

      h('div', { class: 'cfg-group-head' },
        h('span', { class: 'cfg-name mono', text: 'What is said' }),
        h('span', { class: 'hint muted', text: 'one at a time, in order' })),
      ...scene.lines.map((line, at) => lineRow(scene, line, at)),
      h('button', {
        class: 'quiet tiny', text: '+ Add a line',
        onclick: () => {
          scene.lines.push({ who: '', mood: '', say: '' });
          commit(model);
          render();
        },
      }),

      h('div', { class: 'cfg-group-head' },
        h('span', { class: 'cfg-name mono', text: 'Then' }),
        pick(AFTER, after, (e) => setAfter(scene, e.currentTarget.value))),
      after === 'choices'
        ? h('div', {},
          ...scene.choices.map((choice, at) => choiceRow(scene, choice, at)),
          h('button', {
            class: 'quiet tiny', text: '+ Add a choice',
            onclick: () => {
              scene.choices.push({
                say: '', go: keys.find((k) => k !== scene.key) ?? scene.key, set: '', need: '',
              });
              commit(model);
              render();
            },
          }))
        : null,
      after === 'go'
        ? h('div', { class: 'row' }, pick(
          keys.filter((k) => k !== scene.key).map((k) => [k, k]),
          scene.go,
          (e) => { scene.go = e.currentTarget.value; commit(model); },
        ))
        : null,

      ...problemsFor(scene.key).map((c) => h('p', { class: 'hint muted', text: `⚠ ${c.say}` })));
  };

  /* The list --------------------------------------------------------------- */

  const sceneRow = (scene, at) => {
    const shown = S.open.scene === scene.key;
    const problems = problemsFor(scene.key).length;
    const after = afterOf(scene);
    const tail = after === 'choices'
      ? `${scene.choices.length} choice${scene.choices.length === 1 ? '' : 's'}`
      : after === 'go' ? `→ ${scene.go}` : 'the end';
    return h('div', { class: `story-scene${shown ? ' on' : ''}` },
      h('div', {
        class: 'story-scene-row row',
        onclick: () => open(scene.key),
      },
        h('span', { class: 'cfg-name mono', text: scene.key }),
        at === 0 ? h('span', { class: 'hint muted', text: 'starts here' }) : null,
        h('span', { class: 'story-first', text: scene.lines[0]?.say ?? '' }),
        h('div', { class: 'spacer' }),
        problems
          ? h('span', {
            class: 'hint warn',
            text: `⚠ ${problems}`,
            title: problemsFor(scene.key).map((c) => c.say).join('\n'),
          })
          : null,
        h('span', { class: 'hint muted', text: tail })),
      shown ? sceneBody(scene) : null);
  };

  /* The cast --------------------------------------------------------------- */

  const castRow = (person, at) => {
    const used = scenes.reduce(
      (n, s) => n + s.lines.filter((l) => l.who === person.key).length, 0,
    );
    return h('div', { class: 'story-scene' },
      h('div', { class: 'row' },
        field(person.name, 'Their name', (e) => {
          person.name = e.currentTarget.value;
          commit(model);
        }),
        h('div', { class: 'spacer' }),
        h('button', {
          class: 'icon tiny', text: '✕',
          title: used
            ? `${used} line${used === 1 ? '' : 's'} still said by them`
            : 'Remove them from the cast',
          disabled: used > 0,
          onclick: () => { cast.splice(at, 1); commit(model); render(); },
        })),
      h('div', { class: 'row story-moods' },
        h('span', { class: 'hint muted', text: 'Moods' }),
        ...person.moods.map((mood, mi) => h('span', { class: 'story-mood' },
          h('span', { class: 'mono', text: mood }),
          h('button', {
            class: 'icon tiny', text: '✕', title: `Remove ${mood}`,
            onclick: () => { person.moods.splice(mi, 1); commit(model); render(); },
          }))),
        h('button', {
          class: 'quiet tiny', text: '+ Add a mood',
          onclick: () => {
            person.moods.push(freshKey('', person.moods, 'mood'));
            commit(model);
            render();
          },
        })),
      // The filenames the story will ask for. Naming them here is how somebody
      // knows what to call the picture they are about to draw.
      h('p', {
        class: 'hint muted',
        text: person.moods.length
          ? `Pictures: ${person.moods.map((m) => `assets/sprites/${person.key}-${m}.png`).join(', ')}`
          : 'No moods yet, so this person is never shown.',
      }));
  };

  /* ------------------------------------------------------------------------ */

  return [
    h('div', { class: 'scroll cfg', 'data-scroll': 'story' },
      h('div', { class: 'cfg-group-head' },
        h('span', { class: 'cfg-name mono', text: 'The scenes' }),
        h('span', {
          class: 'hint muted',
          text: `${shape.scenes} scene${shape.scenes === 1 ? '' : 's'}, `
            + `${shape.endings} ending${shape.endings === 1 ? '' : 's'}`
            + (checks.length ? ` · ⚠ ${checks.length} to look at` : ''),
        })),
      ...scenes.map(sceneRow),
      h('button', {
        class: 'quiet tiny', text: '+ Add a scene',
        onclick: () => {
          const key = freshKey('', keys);
          scenes.push({ key, picture: '', sound: '', lines: [], choices: [], go: '' });
          S.open.scene = key;
          commit(model);
          render();
        },
      }),

      h('div', { class: 'cfg-group-head' },
        h('span', { class: 'cfg-name mono', text: 'Who is in it' }),
        h('span', { class: 'hint muted', text: 'a mood is a picture of their face' })),
      ...cast.map(castRow),
      h('button', {
        class: 'quiet tiny', text: '+ Add someone',
        onclick: () => {
          cast.push({ key: freshKey('', cast.map((p) => p.key), 'person'), name: '', moods: [] });
          commit(model);
          render();
        },
      })),

    h('div', { class: 'editor-bar row' },
      h('span', {
        class: 'hint muted', id: 'cfg-status', text: S.open.dirty ? 'Not saved yet' : 'Saved',
      }),
      h('div', { class: 'spacer' }),
      h('button', {
        class: 'link', text: 'Show the text',
        onclick: () => { S.open.asText = true; render(); },
      }),
      h('button', {
        class: 'filled', id: 'save-btn', text: 'Save',
        disabled: !S.open.dirty || frozen(),
        onclick: () => saveOpenFile(),
      })),
  ];
}
