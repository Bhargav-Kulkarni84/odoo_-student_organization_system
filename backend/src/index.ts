import express from 'express'
const app = express();
import version from './routes/version.js'

app.use(express.json());
app.use(version);

app.listen(3000,()=>{
    console.log("Listening on 3000");
})
