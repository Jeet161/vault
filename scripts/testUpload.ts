import fetch from 'node-fetch';

async function testUpload() {
  console.log('Testing upload to http://localhost:4000/objects...');
  try {
    const blob = new Blob(['Hello Vault System Test Content'], { type: 'text/plain' });
    const formData = new FormData();
    formData.append('file', blob, 'test-document.txt');

    const res = await fetch('http://localhost:4000/objects', {
      method: 'POST',
      body: formData as any
    });

    console.log('Status code:', res.status);
    const text = await res.text();
    console.log('Response body:', text);
  } catch (err: any) {
    console.error('Upload request error:', err.message);
  }
}

testUpload();
