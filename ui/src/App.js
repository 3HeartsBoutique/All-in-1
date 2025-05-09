import React, { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import axios from 'axios';

function App() {
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);

  const onDrop = useCallback(accepted => {
    setFiles(accepted);
  }, []);

  const { getRootProps, getInputProps } = useDropzone({ onDrop });

  const handleUpload = async () => {
    if (!files.length) return;
    setUploading(true);
    const form = new FormData();
    files.forEach(f => form.append('photos', f));

    try {
      const resp = await axios.post(
        '/api/enrich',
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );
      setResult(resp.data);
    } catch {
      alert('Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>Upload Product Photos</h1>
      <div
        {...getRootProps()}
        style={{
          border: '2px dashed #666',
          padding: '1rem',
          marginBottom: '1rem',
          cursor: 'pointer'
        }}
      >
        <input {...getInputProps()} />
        {files.length
          ? files.map(f => <p key={f.name}>{f.name}</p>)
          : <p>Drag & drop photos here, or click to select</p>}
      </div>
      <button onClick={handleUpload} disabled={uploading}>
        {uploading ? 'Uploading…' : 'Generate SKU & SEO'}
      </button>
      {result && (
        <pre style={{ marginTop: '2rem', background: '#f4f4f4', padding: '1rem' }}>
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default App;
