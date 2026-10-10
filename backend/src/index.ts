import express from 'express'
const app = express();
import version from './routes/version.js'

app.use(version);
app.use(express.json());

app.listen(3000,()=>{
    console.log("Listening on 3000");
})