const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { _parseAtomLatest } = require('../../src/updateCheck');

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>tag:github.com,2008:https://github.com/eboudrant/papa-stud/releases</id>
  <entry>
    <id>tag:github.com,2008:Repository/x/v0.0.14</id>
    <updated>2026-05-12T16:54:48Z</updated>
    <link rel="alternate" type="text/html" href="https://github.com/eboudrant/papa-stud/releases/tag/v0.0.14"/>
    <title>v0.0.14</title>
  </entry>
  <entry>
    <title>v0.0.13</title>
    <link rel="alternate" type="text/html" href="https://github.com/eboudrant/papa-stud/releases/tag/v0.0.13"/>
  </entry>
</feed>`;

describe('updateCheck._parseAtomLatest', () => {
  it('extracts the newest entry from a GitHub releases atom feed', () => {
    assert.deepEqual(_parseAtomLatest(SAMPLE), {
      tag_name: 'v0.0.14',
      html_url: 'https://github.com/eboudrant/papa-stud/releases/tag/v0.0.14',
    });
  });

  it('throws when the feed has no entries', () => {
    assert.throws(() => _parseAtomLatest('<feed></feed>'), /no entries/);
  });

  it('throws when an entry has no title', () => {
    assert.throws(
      () => _parseAtomLatest('<entry><link href="x"/></entry>'),
      /no title/,
    );
  });

  it('tolerates an entry without an explicit link', () => {
    const r = _parseAtomLatest('<entry><title>v1.2.3</title></entry>');
    assert.equal(r.tag_name, 'v1.2.3');
    assert.equal(r.html_url, null);
  });
});
