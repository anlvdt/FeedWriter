"use strict";

// Unified data model for cross-platform posting.
// Normalize content once, fan-out to Facebook, Threads, X, LinkedIn, Reddit.

const PostData = {
  create(opts = {}) {
    return {
      title: opts.title || "",
      content: opts.content || "",
      images: Array.isArray(opts.images) ? opts.images : [],
      videos: Array.isArray(opts.videos) ? opts.videos : [],
      tags: Array.isArray(opts.tags) ? opts.tags : [],
      sourceUrl: opts.sourceUrl || "",
      author: opts.author || "",
      source: opts.source || "",
      autoPublish: !!opts.autoPublish,
    };
  },

  fromFeedWriter(text, sourceUrl, imageUrl, author, source, allImages) {
    const imageList = Array.isArray(allImages) && allImages.length > 0
      ? allImages.slice(0, 10)
      : (imageUrl ? [imageUrl] : []);
    if (imageUrl && !imageList.includes(imageUrl)) imageList.unshift(imageUrl);

    return PostData.create({
      content: text,
      images: imageList.map((url, i) => ({
        name: `image-${i}.jpg`,
        url,
        type: "image/jpeg",
      })),
      sourceUrl,
      author,
      source,
    });
  },

  getTextWithTags(data) {
    const tagSuffix = data.tags.length > 0
      ? " " + data.tags.map(t => `#${t}`).join(" ")
      : "";
    const titlePrefix = data.title ? data.title + "\n" : "";
    return titlePrefix + (data.content || "") + tagSuffix;
  },
};
