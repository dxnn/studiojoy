// One VAPID key pair, printed as the three lines studio.env wants
// (spec/ §6, ideas/notifications.md rung 2). Run once for a studio and never
// again: the public half is what every browser subscribed with, so a new pair
// silently stops every existing subscription from working — the push service
// keeps taking the message and the browser it was for never sees it.
//
// The pair is the same shape `web-push` generates, so one made by either
// works with the other.
import { makeKeys } from '../server/push.js';

const subject = process.argv[2];
if (!subject) {
  console.error('usage: npm run pushkeys -- mailto:you@example.com');
  console.error();
  console.error('The address is what a push service contacts if this studio');
  console.error('starts misbehaving. It has to be a mailto: or an https: URL.');
  process.exit(1);
}
if (!/^(mailto:|https:\/\/)/.test(subject)) {
  console.error(`"${subject}" is not a mailto: address or an https: URL`);
  process.exit(1);
}

const { publicKey, privateKey } = await makeKeys();

console.log('# Put these three in studio.env, then restart the studio.');
console.log('# ⚠️ Once a browser has subscribed, changing them means it stops');
console.log('#    hearing anything — and nothing anywhere says so.');
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log(`VAPID_SUBJECT=${subject}`);
