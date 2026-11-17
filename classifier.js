let model;
let queue = Promise.resolve();

async function classify(source) {
  const response = await fetch(source, {
    credentials: 'omit',
    redirect: 'error',
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) {
    throw new Error('画像を取得できません');
  }
  const image = await createImageBitmap(await response.blob(), {
    resizeWidth: 224, resizeHeight: 224,
  });
  try {
    model ??= XImageModel.loadModel().catch(error => {
      model = undefined;
      throw error;
    });
    const predictions = await (await model).classify(image, 5);
    return Object.fromEntries(predictions.map(({ className, probability }) => [className, probability]));
  } finally {
    image.close();
  }
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.target !== 'classifier' || sender.id !== chrome.runtime.id ||
      sender.tab) return;
  const source = imageSource(message.source);
  if (!source) return;
  const job = queue.then(() => classify(source));
  queue = job.catch(() => {});
  job.then(scores => reply({ scores }), () => reply({}));
  return true;
});
