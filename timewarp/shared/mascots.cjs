"use strict";

const choices = ['orbit', 'nova', 'cosmo'].map(name => ({
  imageId: 'timewarp-' + name,
  name: name[0].toUpperCase() + name.slice(1),
  avatarUrl: `http://127.0.0.1:7788/mascots/${name}.png`,
}));

module.exports = { choices };
