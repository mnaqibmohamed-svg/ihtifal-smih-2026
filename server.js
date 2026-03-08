const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const basicAuth = require('express-basic-auth');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Sistem Keselamatan
const kunciUrusetia = basicAuth({
    users: { 'admin': 'smih2026' },
    challenge: true,
    unauthorizedResponse: 'Akses Ditolak! Sila masukkan ID dan Kata Laluan yang sah.'
});

app.use('/admin.html', kunciUrusetia);
app.use('/kaunter.html', kunciUrusetia);
app.use(express.static('public'));

// Sambungan Pangkalan Data Supabase
const pool = new Pool({
    connectionString: 'postgresql://postgres:qA8ZuPbmiZbxRDbs@db.pvhqwprecftxldegojzt.supabase.co:5432/postgres',
    ssl: { rejectUnauthorized: false }
});

const upload = multer({ dest: 'uploads/' });

// =====================================
// API ROUTES
// =====================================

// API 1: Upload CSV (Versi Kebal Ralat & Kemas Kini Automatik)
app.post('/api/upload', kunciUrusetia, upload.single('file'), (req, res) => {
    const results = [];
    fs.createReadStream(req.file.path)
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', async () => {
            let berjaya = 0;
            for (const row of results) {
                try {
                    // Fungsi Carian Lajur Pintar (Abaikan huruf besar/kecil & jarak)
                    const cariLajur = (senaraiKunci) => {
                        const rowKeys = Object.keys(row);
                        for (let kunci of senaraiKunci) {
                            for (let rk of rowKeys) {
                                // Bersihkan teks untuk perbandingan tepat
                                if (rk.toLowerCase().trim().replace(/[^a-z0-9]/g, '') === kunci.toLowerCase().replace(/[^a-z0-9]/g, '')) {
                                    return row[rk];
                                }
                            }
                        }
                        return null;
                    };

                    const nama = cariLajur(['nama', 'namapelajar']);
                    const ic = cariLajur(['ic', 'noic']);
                    const kelas = cariLajur(['kelas', 'tingkatan']);
                    const anugerah = cariLajur(['anugerah', 'kategori']);
                    const waktu = cariLajur(['waktu', 'masa']);

                    // Hanya muat naik jika Nama & IC wujud
                    if (nama && ic) {
                        await pool.query(
                            `INSERT INTO senarai_penerima (nama_pelajar, no_ic, kelas_pelajar, nama_anugerah, waktu_anugerah) 
                             VALUES ($1, $2, $3, $4, $5) 
                             ON CONFLICT (no_ic) 
                             DO UPDATE SET 
                                nama_pelajar = EXCLUDED.nama_pelajar, 
                                kelas_pelajar = EXCLUDED.kelas_pelajar, 
                                nama_anugerah = EXCLUDED.nama_anugerah, 
                                waktu_anugerah = EXCLUDED.waktu_anugerah`,
                            [nama, ic, kelas, anugerah, waktu]
                        );
                        berjaya++;
                    }
                } catch (err) {
                    console.error("Ralat insert:", err.message);
                }
            }
            fs.unlinkSync(req.file.path);
            res.json({ success: true, message: `${berjaya} baris data berjaya diproses ke Supabase!` });
        });
});

app.get('/api/admin/pelajar', kunciUrusetia, async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM senarai_penerima ORDER BY id ASC`);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/semak/:ic', async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM senarai_penerima WHERE no_ic = $1`, [req.params.ic]);
        if (result.rows.length > 0) {
            res.json({ success: true, data: result.rows[0] });
        } else {
            res.json({ success: false, message: "Maaf, No Kad Pengenalan tiada dalam rekod." });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/rsvp', async (req, res) => {
    const { no_ic, status } = req.body;
    try {
        const result = await pool.query(
            `UPDATE senarai_penerima SET status_rsvp = $1 WHERE no_ic = $2`,
            [status, no_ic]
        );
        if (result.rowCount > 0) {
            res.json({ success: true, message: `Terima kasih! Maklum balas direkodkan sebagai: ${status}` });
        } else {
            res.json({ success: false, message: "Ralat: No IC tidak dijumpai." });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/hadir', kunciUrusetia, async (req, res) => {
    const { no_ic } = req.body;
    try {
        const result = await pool.query(
            `UPDATE senarai_penerima SET status_kehadiran = 'Hadir', waktu_daftar = NOW() WHERE no_ic = $1 RETURNING nama_pelajar`,
            [no_ic]
        );
        if (result.rowCount > 0) {
            res.json({ success: true, message: `${result.rows[0].nama_pelajar} disahkan HADIR!` });
        } else {
            res.json({ success: false, message: "Ralat: No IC tidak dijumpai." });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/live-kehadiran', kunciUrusetia, async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM senarai_penerima WHERE status_kehadiran = 'Hadir' ORDER BY waktu_anugerah ASC`);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/admin/reset', async (req, res) => {
    try {
        await pool.query(`TRUNCATE TABLE senarai_penerima RESTART IDENTITY CASCADE`);
        res.json({ success: true, message: "Pangkalan Data Awan Supabase telah dikosongkan!" });
    } catch (err) {
        console.error("Ralat reset:", err.message);
        res.json({ success: false, error: err.message });
    }
});

app.listen(port, () => {
    console.log(`🚀 Server berjalan di http://localhost:${port}`);
    console.log(`⚡ Berhubung dengan Pangkalan Data Awan Supabase...`);
});