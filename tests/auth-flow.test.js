'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'Sahm_Preview_ROLE_SEPARATION.html'), 'utf8');

test('all inline browser scripts parse without syntax errors', () => {
  const scripts = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1]).filter(source => source.trim());
  assert.ok(scripts.length >= 1, 'expected inline application scripts');
  scripts.forEach((source, index) => {
    assert.doesNotThrow(() => new vm.Script(source, { filename: 'inline-script-' + index + '.js' }));
  });
});

test('login screen uses email and password with a create-account entry', () => {
  const start = html.indexOf('function welcome(){');
  const end = html.indexOf('function resetPasswordScreen()', start);
  const screen = html.slice(start, end);
  assert.match(screen, /id="loginEmail"[^>]*type="email"/);
  assert.match(screen, /id="loginPassword"[^>]*type="password"/);
  assert.match(screen, /تسجيل الدخول/);
  assert.match(screen, /data-go="register">إنشاء حساب/);
});

test('registration requires email, password confirmation and explicit terms acceptance', () => {
  const start = html.indexOf('function register(){');
  const end = html.indexOf('const COUNTRIES=', start);
  const screen = html.slice(start, end);
  assert.match(screen, /id="registerEmail"[^>]*type="email"/);
  assert.match(screen, /id="registerPassword"[^>]*type="password"/);
  assert.match(screen, /id="confirmPassword"[^>]*type="password"/);
  assert.match(screen, /type="checkbox" name="terms" required/);
  assert.match(screen, /href="\/terms.html"/);
  assert.match(html, /SahmSupabase\.signUp\(d\.email,d\.password,true\)/);
});

test('profile completion requires a three-part name and a phone with Yemen selected by default', () => {
  const start = html.indexOf('function profileSetup(){');
  const end = html.indexOf('function logout()', start);
  const screen = html.slice(start, end);
  assert.match(screen, /avatarPicker\(\)/);
  assert.match(screen, /اختر أيقونة جاهزة/);
  assert.match(screen, /id="profileFullName" name="fullName" required/);
  assert.match(screen, /id="profileCountry" name="country"/);
  assert.match(screen, /c\[0\]==='YE'\?'selected'/);
  assert.match(screen, /id="profilePhone" name="phone" type="tel"[^>]*required/);
  assert.doesNotMatch(screen, /type="file"/);
  assert.match(html, /parts\.length<3/);
  assert.match(html, /SahmSupabase\.completeProfile\(d\.fullName,phoneE164,selectedAvatarKey\)/);
});

test('authenticated users with incomplete profiles can reach profile setup', () => {
  assert.match(html, /if\(db\.session&&guestOnly\)/);
  assert.match(html, /next\.screenName==='profile-setup'&&activeProfile&&activeProfile\.completed/);
});
