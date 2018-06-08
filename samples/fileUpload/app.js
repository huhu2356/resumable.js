const Resumable = require('./resumableNode');

const fs = require('fs');
const path = require('path');
const Koa = require('koa');
const router = require('koa-router')();
const koaBody = require('koa-body');
const static = require('koa-static');

const resumable = new Resumable(path.join(__dirname, 'tmp'));
const app = new Koa();
const staticPath = './public';

app.use(static(
    path.join(__dirname, staticPath)
));
app.use(koaBody({
    multipart: true,
    formidable: {
        maxFieldsSize: 1024 * 1024 * 100,
        multiples: true
    }
}));
app.use(router.routes());

router.post('/upload', async (ctx, next) => {
    const option = await resumable.post(ctx.request);

    const { validation, filename, identifier } = option;
    if (validation !== 'partly_done' && validation !== 'done') {
        return ctx.status = 404;
    }

    if (validation === 'done') {
        const dst = fs.createWriteStream(path.join(__dirname, filename));
        resumable.write(identifier, dst, () => {
            resumable.clean(identifier);
            console.log('complete');
        });
    }
    return ctx.status = 200;
});

app.listen(3000);
