import React, { useEffect, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import axios from 'axios';
import './App.css';

function App() {
  const [lastSold, setLastSold] = useState([]);
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: 'image/*',
    onDrop: (accepted) => {
      const form = new FormData();
      accepted.forEach(file => form.append('photos', file));
      axios.post('/api/enrich', form)
        .then(res => console.log('Enriched:', res.data))
        .catch(err => console.error(err));
    }
  });

  useEffect(() => {
    // fetch last‐sold on mount
    axios.get('/api/last-sold')
      .then(res => setLastSold(res.data))
      .catch(console.error);

    // refresh hourly
    const iv = setInterval(() => {
      axios.get('/api/last-sold').then(res => setLastSold(res.data));
    }, 1000 * 60 * 60);

    return () => clearInterval(iv);
  }, []);

  return (
    <div className="App">
      <h1>Three Hearts Boutique</h1>

      {/* Upload dropzone */}
      <div {...getRootProps()} className="dropzone">
        <input {...getInputProps()} />
        {
          isDragActive
            ? <p>Drop images here …</p>
            : <p>Drag ‘n’ drop product photos here, or click to select</p>
        }
      </div>

      {/* Last 10 Sold */}
      <section className="last-sold">
        <h2>Last 10 Items Sold</h2>
        <table>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Title</th>
              <th>Sold At</th>
              <th>Price</th>
            </tr>
          </thead>
          <tbody>
            {lastSold.map(item => (
              <tr key={item.sold_at + item.sku}>
                <td>{item.sku}</td>
                <td>{item.title}</td>
                <td>{item.sold_at}</td>
                <td>${item.price}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

export default App;
