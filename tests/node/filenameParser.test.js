const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseFilename } = require('../../src/filenameParser');

describe('parseFilename', () => {
  it('standard filename', () => {
    const r = parseFilename('com.example_LoginTest_testLoginButton.png');
    assert.equal(r.package, 'com.example');
    assert.equal(r.class_name, 'LoginTest');
    assert.equal(r.method, 'testLoginButton');
    assert.equal(r.snapshot_name, null);
  });

  it('nested package', () => {
    const r = parseFilename('app.cash.paparazzi.sample_HelloComposeTest_compose.png');
    assert.equal(r.package, 'app.cash.paparazzi.sample');
    assert.equal(r.class_name, 'HelloComposeTest');
    assert.equal(r.method, 'compose');
  });

  it('with snapshot name', () => {
    const r = parseFilename('com.example_KeypadViewTest_testViews_bolt.png');
    assert.equal(r.package, 'com.example');
    assert.equal(r.class_name, 'KeypadViewTest');
    assert.equal(r.method, 'testViews');
    assert.equal(r.snapshot_name, 'bolt');
  });

  it('snapshot name with underscores', () => {
    const r = parseFilename('com.example_MyTest_testMethod_long_snapshot_name.png');
    assert.equal(r.snapshot_name, 'long_snapshot_name');
  });

  it('no delta prefix expected', () => {
    const r = parseFilename('com.example_LoginTest_testLogin.png');
    assert.equal(r.package, 'com.example');
    assert.equal(r.class_name, 'LoginTest');
    assert.equal(r.method, 'testLogin');
  });

  it('multi dot package', () => {
    const r = parseFilename('com.example.ui_DashboardTest_testHeader.png');
    assert.equal(r.package, 'com.example.ui');
    assert.equal(r.class_name, 'DashboardTest');
    assert.equal(r.method, 'testHeader');
  });

  it('single segment fallback', () => {
    const r = parseFilename('broken.png');
    assert.equal(r.package, '');
    assert.equal(r.class_name, '');
    assert.equal(r.raw, 'broken.png');
  });

  it('raw always present', () => {
    const r = parseFilename('com.example_Foo_bar.png');
    assert.equal(r.raw, 'com.example_Foo_bar.png');
  });
});
