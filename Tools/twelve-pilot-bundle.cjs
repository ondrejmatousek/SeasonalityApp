// Encrypted evidence transport for a PUBLIC GitHub repository. Private key stays local.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
function pack(root,publicKey){
    const files={};function walk(dir){for(const d of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,d.name);if(d.isSymbolicLink())throw Error('Symlink evidence refused');if(d.isDirectory())walk(f);else files[path.relative(root,f).split(path.sep).join('/')]=fs.readFileSync(f).toString('base64');}}walk(root);
    const key=crypto.randomBytes(32),iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv),plain=zlib.gzipSync(Buffer.from(JSON.stringify(files)));
    const ciphertext=Buffer.concat([cipher.update(plain),cipher.final()]);return {version:1,algorithm:'RSA-OAEP-SHA256/AES-256-GCM',key:crypto.publicEncrypt({key:publicKey,oaepHash:'sha256'},key).toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')};
}
function unpack(bundle,privateKey,out){
    const absolute=path.resolve(out);if(!absolute.startsWith(path.resolve('artifacts')+path.sep)||fs.existsSync(absolute))throw Error('New private artifacts directory required');
    if(bundle.version!==1||bundle.algorithm!=='RSA-OAEP-SHA256/AES-256-GCM')throw Error('Unknown bundle');
    const key=crypto.privateDecrypt({key:privateKey,oaepHash:'sha256'},Buffer.from(bundle.key,'base64')),decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(bundle.iv,'base64'));decipher.setAuthTag(Buffer.from(bundle.tag,'base64'));
    const plain=Buffer.concat([decipher.update(Buffer.from(bundle.ciphertext,'base64')),decipher.final()]),files=JSON.parse(zlib.gunzipSync(plain));
    for(const[name,data]of Object.entries(files)){const f=path.resolve(absolute,name);if(!f.startsWith(absolute+path.sep))throw Error('Unsafe evidence filename');fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,Buffer.from(data,'base64'),{flag:'wx'});}
}
module.exports={pack,unpack};
if(require.main===module){const [mode,input,key,out]=process.argv.slice(2);if(mode==='create-keys'){
    const root=path.resolve(input);if(!root.startsWith(path.resolve('artifacts')+path.sep)||fs.existsSync(root))throw Error('New artifacts key directory required');fs.mkdirSync(root,{recursive:true});const pair=crypto.generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});fs.writeFileSync(path.join(root,'private.pem'),pair.privateKey,{mode:0o600,flag:'wx'});fs.writeFileSync(path.join(root,'public.pem'),pair.publicKey,{flag:'wx'});console.log('Local bundle keys created; private key is not logged or committed.');
}else if(mode==='unpack'){unpack(JSON.parse(fs.readFileSync(input)),fs.readFileSync(key),out);console.log('Evidence decrypted locally.');}else throw Error('Use create-keys or unpack');}
