// Recognising the label/invoice endpoints, naming the files, and deciding what
// a response actually contains.
//   node test/labels.test.mjs
import assert from 'node:assert/strict';
import { classifyLabelUrl, labelFilename, looksLikePdf, planSave, DOWNLOAD_FOLDER } from '../labels.js';

const toBase64 = (bytes) => Buffer.from(bytes).toString('base64');
const fromBase64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));

/* 1. The real URLs seen on a live pack */
{
  const label = 'https://partnersapi.myntrainfo.com/api/mdirect/orders/getShippingLabelForSellerPacketV2/2297?sellerId=85764&campaignEnriched=false&sellerOrderId=100360454813';
  const invoice = 'https://partnersapi.myntrainfo.com/api/mdirect/orders/getPacketInvoice/2297?sellerId=85764&campaignEnriched=false&sellerOrderId=100360454813';
  assert.equal(classifyLabelUrl(label), 'label');
  assert.equal(classifyLabelUrl(invoice), 'invoice');
  // A later V3 must still be recognised — the version is not matched on.
  assert.equal(classifyLabelUrl(label.replace('V2', 'V3')), 'label');
  console.log('PASS  both live endpoints recognised, version-independent');
}

/* 1b. The reprint endpoints */
{
  const reprintLabel = 'https://partnersapi.myntrainfo.com/api/mdirect/packets/2297/shipping-labelV2?sellerId=85764&campaignEnriched=false&sellerOrderId=1000226791022';
  const reprintInvoice = 'https://partnersapi.myntrainfo.com/api/mdirect/packets/2297/invoiceV2?sellerId=85764&campaignEnriched=false&sellerOrderId=1000226791022';
  assert.equal(classifyLabelUrl(reprintLabel), 'label');
  assert.equal(classifyLabelUrl(reprintInvoice), 'invoice');
  console.log('PASS  both reprint endpoints recognised');
}

/* 2. Everything else must be ignored */
{
  for (const url of [
    'https://partnersapi.myntrainfo.com/api/mdirect/packets/items/qcpass',
    'https://partnersapi.myntrainfo.com/api/mdirect/packets/1974014045/ready-to-ship',
    'https://mdirect.myntrainfo.com/PackOrder/Operations',
    'https://example.com/getPacketInvoice/2297',   // right path, wrong site
    '', null, undefined, 42,
  ]) {
    assert.equal(classifyLabelUrl(url), null, `should ignore: ${url}`);
  }
  console.log('PASS  qcpass, ready-to-ship, the page itself and other sites ignored');
}

/* 3. Filenames carry the packet id and cannot escape the download folder */
{
  const at = new Date(2026, 8, 27);
  assert.equal(labelFilename({ kind: 'label', packetId: 1974014045, at }),
    `${DOWNLOAD_FOLDER}/2026-09-27/1974014045-label.pdf`);
  assert.equal(labelFilename({ kind: 'invoice', packetId: 1974014045, at }),
    `${DOWNLOAD_FOLDER}/2026-09-27/1974014045-invoice.pdf`);
  // Falls back to the order id, then to a placeholder.
  assert.match(labelFilename({ kind: 'label', orderId: 100360454813, at }), /100360454813-label\.pdf$/);
  assert.match(labelFilename({ kind: 'label', at }), /unknown-label\.pdf$/);
  // Chrome rejects a filename containing ../ — it must be impossible to build one.
  const nasty = labelFilename({ kind: 'label', packetId: '../../../etc/passwd', at });
  assert.ok(!nasty.includes('..'), `path traversal leaked: ${nasty}`);
  assert.ok(nasty.startsWith(`${DOWNLOAD_FOLDER}/`));
  console.log('PASS  filenames carry the packet id, and cannot escape the folder');
}

/* 4. A raw PDF response */
{
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 10, 11, 12]);
  assert.ok(looksLikePdf(pdf));
  const plan = planSave({ contentType: 'application/pdf', bytes: pdf, toBase64, fromBase64 });
  assert.equal(plan.ok, true);
  assert.equal(plan.base64, toBase64(pdf));
  console.log('PASS  a raw PDF response is saved as-is');
}

/* 5. A PDF wrapped as base64 inside JSON, whatever the field is called */
{
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, ...new Array(300).fill(65)]);
  const b64 = toBase64(pdf);
  for (const field of ['data', 'pdfContent', 'whateverTheyCallIt']) {
    const text = JSON.stringify({ status: { statusType: 'SUCCESS' }, [field]: b64 });
    const plan = planSave({ contentType: 'application/json', text, toBase64, fromBase64 });
    assert.equal(plan.ok, true, `field "${field}" not found`);
    assert.equal(plan.base64, b64);
  }
  console.log('PASS  base64 PDF found inside JSON regardless of the field name');
}

/* 6. Anything that is not a PDF must fail loudly, never save junk as .pdf */
{
  assert.deepEqual(
    planSave({ contentType: 'text/html', text: '<!doctype html><html>...', toBase64, fromBase64 }),
    { ok: false, reason: 'html' });
  assert.deepEqual(
    planSave({ contentType: 'application/json', text: '{"status":{"statusMessage":"no"}}', toBase64, fromBase64 }),
    { ok: false, reason: 'json-without-pdf' });
  assert.equal(planSave({ contentType: 'text/plain', text: 'nope', toBase64, fromBase64 }).ok, false);
  console.log('PASS  HTML, empty JSON and plain text are refused, not saved as .pdf');
}

/* 7. The order id can always be read off the URL itself */
{
  const { idsFromLabelUrl } = await import('../labels.js');
  const url = 'https://partnersapi.myntrainfo.com/api/mdirect/orders/getShippingLabelForSellerPacketV2/2297?sellerId=85764&campaignEnriched=false&sellerOrderId=100360454813';
  assert.deepEqual(idsFromLabelUrl(url), { orderId: '100360454813', sellerId: '85764' });
  // Never throws, whatever it is handed.
  assert.deepEqual(idsFromLabelUrl('not a url'), { orderId: null, sellerId: null });
  assert.deepEqual(idsFromLabelUrl(''), { orderId: null, sellerId: null });
  console.log('PASS  order id read from the URL, so naming never depends on request order');
}

/* 8. The diagnostic description, which one test packet has to be enough for */
{
  const { describePayload } = await import('../labels.js');

  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
  const rawSummary = describePayload({ bytes: pdf, contentType: 'application/pdf', fromBase64 });
  assert.equal(rawSummary.verdict, 'raw PDF');
  assert.equal(rawSummary.ascii, '%PDF-1.7');
  assert.equal(rawSummary.head, '25 50 44 46 2d 31 2e 37');

  // JSON carrying a base64 PDF: the field must be named so it can be handled.
  const embedded = toBase64(new Uint8Array([0x25, 0x50, 0x44, 0x46, ...new Array(200).fill(65)]));
  const json = JSON.stringify({ status: { statusCode: 1 }, data: { fileBytes: embedded } });
  const jsonSummary = describePayload({
    bytes: new Uint8Array(Buffer.from(json)), text: json, contentType: 'application/json', fromBase64,
  });
  assert.equal(jsonSummary.verdict, 'JSON');
  assert.deepEqual(jsonSummary.topLevelKeys, ['status', 'data']);
  const hit = jsonSummary.longStrings.find((f) => f.decodesToPdf);
  assert.ok(hit, 'the base64 PDF field should be identified');
  assert.equal(hit.field, 'data.fileBytes', 'and named, so it can be found next time');

  // HTML must be reported with a preview, not silently called unknown.
  const html = '<!doctype html><html><body>label</body></html>';
  const htmlSummary = describePayload({
    bytes: new Uint8Array(Buffer.from(html)), text: html, contentType: 'text/html', fromBase64,
  });
  assert.equal(htmlSummary.verdict, 'HTML/XML');
  assert.ok(htmlSummary.preview.includes('<!doctype'));

  console.log('PASS  payload description names the verdict, the field and a preview');
}

/* 9. The shipping label arrives wrapped in MIME multipart, the invoice bare.
      Built to match the real bytes seen on a live pack: the label began
      "--uuid:29af39c7-…" with MIME headers before "%PDF-1.5". */
{
  const { extractEmbeddedPdf } = await import('../labels.js');

  const pdfBody = Buffer.concat([
    Buffer.from('%PDF-1.5\n%\xe2\xe3\xcf\xd3\n4 0 obj\n<</Subtype/Form>>\n', 'latin1'),
    Buffer.from('trailer\n<</Size 5>>\nstartxref\n1234\n%%EOF', 'latin1'),
  ]);
  const wrapped = Buffer.concat([
    Buffer.from(
      '--uuid:29af39c7-fdd3-416c-9914-a00d74880081\r\n' +
      'Content-Type: application/octet-stream\r\n' +
      'Content-Transfer-Encoding: binary\r\n' +
      'Content-ID: <1>\r\n\r\n', 'latin1'),
    pdfBody,
    Buffer.from('\r\n--uuid:29af39c7-fdd3-416c-9914-a00d74880081--\r\n', 'latin1'),
  ]);

  const bytes = new Uint8Array(wrapped);
  assert.equal(looksLikePdf(bytes), false, 'the envelope is not itself a PDF');

  const inner = extractEmbeddedPdf(bytes);
  assert.ok(looksLikePdf(inner), 'the PDF inside must be found');
  assert.equal(Buffer.compare(Buffer.from(inner), pdfBody), 0, 'exactly the PDF, no envelope either side');

  // And planSave must now accept it rather than refusing.
  const text = wrapped.toString('latin1');
  const plan = planSave({ contentType: 'application/pdf', bytes, text, toBase64, fromBase64 });
  assert.equal(plan.ok, true, 'the wrapped label must be saved');
  assert.equal(plan.unwrapped, true, 'and recorded as having been unwrapped');
  assert.equal(plan.base64, pdfBody.toString('base64'));
  console.log('PASS  MIME-wrapped shipping label unwrapped to exactly its PDF');
}

/* 10. A bare PDF must still be taken as-is, never re-cut */
{
  const bare = Buffer.concat([Buffer.from('%PDF-1.4\nbody\n', 'latin1'), Buffer.from('%%EOF', 'latin1'), Buffer.from('\n', 'latin1')]);
  const bytes = new Uint8Array(bare);
  const plan = planSave({ contentType: 'application/pdf', bytes, text: bare.toString('latin1'), toBase64, fromBase64 });
  assert.equal(plan.ok, true);
  assert.equal(plan.unwrapped, undefined, 'a bare PDF is not unwrapped');
  assert.equal(plan.base64, bare.toString('base64'), 'and is saved byte for byte, trailing newline included');
  console.log('PASS  a bare PDF (the invoice) is still saved untouched');
}

/* 11. An envelope with no PDF in it is still refused */
{
  const junk = Buffer.from('--uuid:abc\r\nContent-Type: text/plain\r\n\r\nno document here', 'latin1');
  const plan = planSave({
    contentType: 'application/pdf', bytes: new Uint8Array(junk), text: junk.toString('latin1'), toBase64, fromBase64,
  });
  assert.equal(plan.ok, false, 'an envelope with no PDF must not be saved');
  console.log('PASS  an envelope containing no PDF is still refused');
}
