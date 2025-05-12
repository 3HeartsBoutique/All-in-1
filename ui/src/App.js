import React, { useState, useEffect } from 'react';
import './App.css';
import { useDropzone } from 'react-dropzone';
import axios from 'axios';

function App() {
  const [lastSold, setLastSold] = useState([]);
  const [files, setFiles]     = useState([]);
  const [enrichResult, setEnrichResult] = useState(null);
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: acceptedFiles => setFiles(acceptedFiles)
  });

  // Fetch last-sold on mount + every hour
  useEffect(() => {
    const fetchLastSold = async () => {
      try {
        const resp = await axios.get('/api/last-sold');
        setLastSold(resp.data);
      } catch (err) {
        console.error('Could not load last-sold', err);
      }
    };
    fetchLastSold();
    const iv = setInterval(fetchLastSold, 1000 * 60 * 60);
    return () => clearInterval(iv);
  }, []);

  // upload & enrich handler
  const handleEnrich = async () => {
    if (files.length === 0) return alert('Please select photos first');
    const form = new FormData();
    files.forEach(f => form.append('photos', f));
    try {
      const resp = await axios.post('/api/enrich', form, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setEnrichResult(resp.data);
    } catch (err) {
      console.error('Enrich failed', err);
      alert('Enrich failed');
    }
  };

  return (
    <div className="App" style={{ maxWidth: 800, margin: '0 auto', padding: '1rem' }}>
      <h1>Three Hearts Boutique</h1>

      {/* 1) Drag & drop */}
      <div
        {...getRootProps()}
        style={{
          border: '2px dashed #666',
          padding: '1rem',
          marginBottom: '1rem',
          cursor: 'pointer',
          textAlign: 'center'
        }}
      >
        <input {...getInputProps()} />
        {isDragActive
          ? <p>Drop photos here…</p>
          : <p>Drag ‘n’ drop product photos here, or click to select</p>}
      </div>

      {/* 2) Preview selected files */}
      {files.length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          <strong>Selected files:</strong>
          <ul>
            {files.map(f => <li key={f.path || f.name}>{f.name}</li>)}
          </ul>
        </div>
      )}

      {/* 3) Upload & Enrich button */}
      <button onClick={handleEnrich} disabled={files.length === 0}>
        Upload & Generate SKU / SEO
      </button>

      {/* 4) Show enrich result */}
      {enrichResult && (
        <div style={{ marginTop: '1rem', padding: '1rem', border: '1px solid #ccc' }}>
          <h2>Enrichment Result</h2>
          <p><strong>SKU:</strong> {enrichResult.sku}</p>
          <p><strong>Title:</strong> {enrichResult.seo.title}</p>
          <p><strong>Description:</strong> {enrichResult.seo.description}</p>
          <img src={enrichResult.barcode} alt="barcode" />
        </div>
      )}

      {/* 5) Last 10 items sold */}
      <h2 style={{ marginTop: '2rem' }}>Last 10 Items Sold</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {['SKU','Title','Sold At','Price'].map(col => (
              <th
                key={col}
                style={{ borderBottom: '1px solid #ccc', textAlign: 'left', padding: '0.5rem' }}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lastSold.map((row,i) => (
            <tr key={i}>
              <td style={{ padding: '0.5rem 0' }}>{row.sku}</td>
              <td style={{ padding: '0.5rem 0' }}>{row.title}</td>
              <td style={{ padding: '0.5rem 0' }}>{row.sold_at}</td>
              <td style={{ padding: '0.5rem 0' }}>${row.price}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default App;
