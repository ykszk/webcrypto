import React, { useState } from 'react';
import Typography from '@material-ui/core/Typography';
import { Box, Button, TextField } from '@material-ui/core';
import { Card, CardContent, CardActions } from '@material-ui/core';
import { download, toClipboard } from './Utils';

const isCryptoKeyPair = (
  keyPair: CryptoKey | CryptoKeyPair,
): keyPair is CryptoKeyPair => {
  return (keyPair as CryptoKeyPair).privateKey !== undefined;
};

/**
Convert a string into an ArrayBuffer
from https://developers.google.com/web/updates/2012/06/How-to-convert-ArrayBuffer-to-and-from-String
*/
function str2ab(str: string) {
  const buf = new ArrayBuffer(str.length);
  const bufView = new Uint8Array(buf);
  for (let i = 0, strLen = str.length; i < strLen; i++) {
    bufView[i] = str.charCodeAt(i);
  }
  return buf;
}

/**
Convert  an ArrayBuffer into a string
from https://developers.google.com/web/updates/2012/06/How-to-convert-ArrayBuffer-to-and-from-String
*/
export function ab2str(buf: ArrayBuffer) {
  let a = new Uint8Array(buf);
  return String.fromCharCode.apply(null, a as any);
}

function extractPemContent(pem: string, header: string, footer: string) {
  const contentStart = pem.indexOf(header);
  const contentEnd = pem.indexOf(footer);
  const pemContents = pem.substring(contentStart + header.length, contentEnd);
  return pemContents;
}

async function importPrivateKey(pem: string) {
  // fetch the part of the PEM string between header and footer
  const pemHeader = '-----BEGIN PRIVATE KEY-----';
  const pemFooter = '-----END PRIVATE KEY-----';
  const pemContents = extractPemContent(pem, pemHeader, pemFooter);
  // base64 decode the string to get the binary data
  const binaryDerString = window.atob(pemContents);
  // convert from a binary string to an ArrayBuffer
  const binaryDer = str2ab(binaryDerString);

  return window.crypto.subtle.importKey(
    'pkcs8',
    binaryDer,
    {
      name: 'RSA-OAEP',
      hash: 'SHA-256',
    },
    true,
    ['decrypt'],
  );
}

export async function importPublicKey(pem: string) {
  // fetch the part of the PEM string between header and footer
  const pemHeader = '-----BEGIN PUBLIC KEY-----';
  const pemFooter = '-----END PUBLIC KEY-----';
  const pemContents = extractPemContent(pem, pemHeader, pemFooter);
  // base64 decode the string to get the binary data
  const binaryDerString = window.atob(pemContents);
  // convert from a binary string to an ArrayBuffer
  const binaryDer = str2ab(binaryDerString);

  return window.crypto.subtle.importKey(
    'spki',
    binaryDer,
    {
      name: 'RSA-OAEP',
      hash: 'SHA-256',
    },
    true,
    ['encrypt'],
  );
}
async function parseKeyPair(keyPairStr: string): Promise<CryptoKeyPair> {
  return Promise.all([
    importPrivateKey(keyPairStr),
    importPublicKey(keyPairStr),
  ]).then((keyPair) => ({ privateKey: keyPair[0], publicKey: keyPair[1] }));
}

/**
 * Open file dialog -> load text file and parse -> return keyPair
 */
async function loadKeyPair(): Promise<CryptoKeyPair> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'text/plain';
    input.multiple = false;
    function fileHandler(event: Event) {
      const fileList = input.files;
      if (fileList !== null && fileList.length > 0) {
        const reader = new FileReader();
        reader.onload = () => {
          const keyStr = reader.result as string;
          parseKeyPair(keyStr)
            .then((keyPair) => resolve(keyPair))
            .catch(() => reject());
        };
        reader.readAsText(fileList[0]);
      } else {
        reject();
      }
    }
    input.onchange = fileHandler;
    input.click();
  });
}

/**
 * Wrap base64 encoded contents with pem header and footer.
 */
function pemWrap(contents: string, label: string) {
  return `-----BEGIN ${label}-----\n${contents}\n-----END ${label}-----`;
}

/**
 * Export key in pem format
 */
async function exportKey(
  key: CryptoKey,
  format: 'pkcs8' | 'raw' | 'spki',
  label: string,
) {
  const exported = await window.crypto.subtle.exportKey(format, key);
  const exportedAsString = ab2str(exported);
  const exportedAsBase64 = window.btoa(exportedAsString);
  return pemWrap(exportedAsBase64, label);
}

async function exportPrivateKey(key: CryptoKey) {
  return exportKey(key, 'pkcs8', 'PRIVATE KEY');
}

async function exportPublicKey(key: CryptoKey) {
  return exportKey(key, 'spki', 'PUBLIC KEY');
}

function emojiencode(buf: ArrayBuffer) {
  const a = Array.from(new Uint8Array(buf));
  const codePoints = a.map((value) => {
    if (value <= 80) {
      //🍀 to 🎏
      return value + 0x1f340;
    }
    if (value <= 144) {
      // 🐀 to 🐿
      return value + 0x1f400 - 81;
    }
    if (value <= 176) {
      // 👤 to 💃
      return value + 0x1f464 - 145;
    }
    // 🗻 to 🙊
    return value + 0x1f5fb - 177;
  });
  return String.fromCodePoint.apply(null, codePoints);
}

function createFingerprint(key: string) {
  return window.crypto.subtle
    .digest('SHA-256', str2ab(key))
    .then((digest) => emojiencode(digest));
}
interface Props {
  onKeyPairChange: (keyPair: CryptoKeyPair) => void;
}

export function KeyManager(props: Props) {
  const [exportedPrivateKey, setExportedPrivateKey] = useState('');
  const [exportedPublicKey, setExportedPublicKey] = useState('');
  const [privateFingerprint, setPrivateFingerprint] = useState('');
  const [publicFingerprint, setPublicFingerprint] = useState('');
  const [saveEnabled, setSaveEnabled] = useState(false);

  function setKeyPair(keyPair: CryptoKeyPair) {
    Promise.all([
      exportPrivateKey(keyPair.privateKey),
      exportPublicKey(keyPair.publicKey),
    ]).then((keyStrings) => {
      const [privKey, publicKey] = keyStrings;
      localStorage.setItem('keyPair', publicKey + '\n' + privKey);
      Promise.all([
        createFingerprint(privKey),
        createFingerprint(publicKey),
      ]).then((keys) => {
        const [priv, pub] = keys;
        setExportedPrivateKey(privKey);
        setExportedPublicKey(publicKey);
        setPrivateFingerprint(priv);
        setPublicFingerprint(pub);
      });
      setSaveEnabled(true);
      props.onKeyPairChange(keyPair);
    });
  }
  function generateKey() {
    window.crypto.subtle
      .generateKey(
        {
          name: 'RSA-OAEP',
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: 'SHA-256',
        },
        true,
        ['encrypt', 'decrypt'],
      )
      .then((keyPair) => {
        if (isCryptoKeyPair(keyPair)) {
          console.log('New key pair is generated.');
          setSaveEnabled(true);
          setKeyPair(keyPair);
        }
      });
  }
  function importKeyPair() {
    loadKeyPair()
      .then((keyPair) => {
        setKeyPair(keyPair);
      })
      .catch((error) => {
        console.log(error);
      });
  }

  (() => {
    const localKeyPair = localStorage.getItem('keyPair');
    if (
      localKeyPair !== null &&
      exportedPrivateKey === '' &&
      exportedPublicKey === ''
    ) {
      console.log('Load key pair from localStorage');
      parseKeyPair(localKeyPair).then((keyPair) => {
        setKeyPair(keyPair);
      });
    }
  })();

  return (
    <Card variant="outlined">
      <CardContent>
        <Box className="vspacing">
          <Typography variant="h5" component="h2">
            🗝️Your Key Pair
          </Typography>
          <Box
            display="flex"
            justifyContent="space-between"
            alignItems="stretch"
          >
            <Box width="30%">
              <Card variant="outlined">
                <CardContent>
                  <TextField
                    multiline={true}
                    spellCheck={false}
                    rows={2}
                    variant="filled"
                    fullWidth={true}
                    label="Public Key's Fingerprint"
                    InputProps={{
                      readOnly: true,
                    }}
                    value={publicFingerprint || ''}
                  />
                </CardContent>
                <Box display="flex" justifyContent="flex-end">
                  <CardActions>
                    <Button
                      title="Copy public key"
                      disabled={!saveEnabled}
                      onClick={() => toClipboard(exportedPublicKey)}
                      size="small"
                      variant="outlined"
                    >
                      Copy
                    </Button>
                  </CardActions>
                </Box>
              </Card>
            </Box>
            <Box width="30%">
              <Card variant="outlined">
                <CardContent>
                  <TextField
                    multiline={true}
                    spellCheck={false}
                    rows={2}
                    variant="filled"
                    fullWidth={true}
                    label="Private Key's Fingerprint"
                    InputProps={{
                      readOnly: true,
                    }}
                    value={privateFingerprint || ''}
                  />
                </CardContent>
              </Card>
            </Box>
            <Box
              width="30%"
              display="flex"
              flexDirection="column"
              justifyContent="space-around"
            >
              <Button onClick={generateKey} variant="outlined">
                Generate Key Pair
              </Button>
              <Button onClick={importKeyPair} variant="outlined">
                Load Key Pair
              </Button>
              <Button
                disabled={!saveEnabled}
                variant="outlined"
                onClick={() =>
                  download(
                    exportedPublicKey + '\n' + exportedPrivateKey,
                    'KeyPair.txt',
                  )
                }
              >
                Save Key Pair
              </Button>
            </Box>
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}
