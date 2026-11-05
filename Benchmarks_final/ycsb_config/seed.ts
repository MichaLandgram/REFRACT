// seed.ts
import { argv } from 'process';

const count = parseInt(argv[2] || '1000', 10);
const port = parseInt(argv[3] || '3001', 10);
const url = `http://localhost:${port}/nodes`;

async function seed() {
  console.log(`Seeding ${count} nodes to ${url}...`);
  const start = Date.now();
  
  const batchSize = 100;
  for (let i = 1; i <= count; i += batchSize) {
    if (i % 1000 === 1) {
      console.log(`Seeding nodes ${i} to ${Math.min(i + batchSize - 1, count)}...`);
    }
    const promises = [];
    for (let j = 0; j < batchSize && i + j <= count; j++) {
      const id = `node${i + j}`;
      promises.push(
        fetch(`${url}/${id}?type=Person`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            firstName: `User${i + j}`,
            lastName: `LastName${i + j}`,
            birthday: '1990-01-01',
            field0: `Value0-${i + j}`,
            field1: `Value1-${i + j}`,
            field2: `Value2-${i + j}`,
            field3: `Value3-${i + j}`,
            field4: `Value4-${i + j}`,
            field5: `Value5-${i + j}`,
            field6: `Value6-${i + j}`,
            field7: `Value7-${i + j}`,
            field8: `Value8-${i + j}`,
            field9: `Value9-${i + j}`,
            field10: `Value10-${i + j}`
          }),
        }).then(async (res) => {
          if (!res.ok) {
            console.error(`Failed to seed ${id}: ${res.statusText}`);
          }
        }).catch((err) => {
          console.error(`Error seeding ${id}:`, err.message);
        })
      );
    }
    await Promise.all(promises);
  }
  
  console.log(`Seeding completed in ${((Date.now() - start) / 1000).toFixed(2)}s`);
}

seed().catch(console.error);
