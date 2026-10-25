import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import {loginWithPassword, errorText, episodeDanmaku, danmakuEpisodeNumber, nextTheme} from './src/compat.js';

const user = {username: 'test-fixture', password: 'fixture-密碼%', app_name: 'trimemedia-web'};
const calls = [];
const modern = async (...args) => {
  calls.push(args);
  return args[0] === 'GET' ? {version: '0.9.8'} : {token: 'test-only'};
};
await loginWithPassword(modern, user);
assert.equal(calls[1][1], '/api/v2/user/loginByPassword');
assert.equal(calls[1][3].password, createHash('sha256').update(user.password).digest('hex'));
assert.equal(user.password, 'fixture-密碼%');
calls.length = 0;
await loginWithPassword(async (...args) => {
  calls.push(args);
  return args[0] === 'GET' ? {version: '0.9.4'} : {token: 'test-only'};
}, user);
assert.equal(calls[1][1], '/api/v1/login');
assert.equal(calls[1][3].password, user.password);
let postCount = 0;
await assert.rejects(loginWithPassword(async (method) => {
  if (method === 'GET') return {version: '0.9.8'};
  postCount++;
  throw new Error('账号或密码错误');
}, user), /账号或密码错误/);
assert.equal(postCount, 1, 'A failed login must not retry another password endpoint');
await assert.rejects(loginWithPassword(async () => ({version: '0.9.8'}), user), /有效凭证/);
assert.equal(errorText({data: {code: -15, msg: 'Password Incorrect'}}), '账号或密码错误');
assert.equal(errorText({data: {msg: {message: 'Invalid Params'}}}), 'Invalid Params');
assert.equal(errorText(new Error('HTTP error')), 'HTTP error');
assert.deepEqual(episodeDanmaku({}, 1), []);
assert.deepEqual(episodeDanmaku({'1': [{text: 'ok'}]}, 1), [{text: 'ok'}]);
assert.deepEqual(episodeDanmaku({'2': [{text: 'other episode'}]}, 1), []);
assert.throws(() => episodeDanmaku({code: -1, msg: 'source failed'}, 1), /source failed/);
assert.throws(() => episodeDanmaku({'1': {}}, 1), /格式异常/);
assert.equal(nextTheme(false, {name:'dark'}).dark, true);
assert.equal(nextTheme(true, {name:'dark'}).dark, false);
console.log('PASS: modern and legacy login, single-attempt errors, valid token, error text and empty danmaku');

assert.equal(danmakuEpisodeNumber({type:'Movie', episode_number:0}),1);
assert.equal(danmakuEpisodeNumber({episode_number:3}),3);
assert.equal(danmakuEpisodeNumber({episode_number:-1}),1);
