'use strict';

const fs = require('fs'),
      moment = require('moment'),
      assert = require('assert'),
      logger = require('./logger').getLogger();
      
const FILE_OPS = {encoding: 'utf8'};

exports.readProxyData = function (fileName) {
  let content = fs.readFileSync('data/' + fileName, FILE_OPS);
  return transformProxyDataFromString(content);
};

exports.storeProxyData = function (fileName, target) {
  return fs.writeFileSync('data/' + fileName, JSON.stringify(target.list), FILE_OPS);
};

exports.addProxy = function (target, proxy, cookie, done) {
  let d = newProxyData(proxy);
  target.list.push(d);
  target.map[d.proxy] = d;
  this.storeCookie(d.proxy, cookie, done);
  return d;
};

exports.storeCookie = function (proxy, cookie, done) {
  let file = 'data/cookie';
  fs.readFile(file, FILE_OPS, function (err, content) {
    assert.equal(err, null);
    fs.writeFile(file, content + moment().format('YY-MM-DD HH:mm:ss') + ',' + proxy + ',' + cookie + '\n', FILE_OPS, function (err) {
      assert.equal(err, null);
      done();
    });
  });
};

exports.printPrettyProxyData = function (target) {
  target.list.forEach(function (one) {
    logger.info('proxy: %s, %s, %s, %s', one.proxy, moment(one.lastUsedTime).format('YY-MM-DD HH:mm:ss'), one.usedCount, one.source);
  });
};

/*
 format: {proxy: '8.8.8.8:6321', lastUsedTime: 1473236378388, usedCount: 123, source: 'xicidaili'}
*/
const transformProxyDataFromString = function  (content) {
  let target = {
    list: JSON.parse(content),
    map: {}
  };
  target.list.forEach(function (o) {
    target.map[o.proxy] = o;
  });
  return target;
};

const newProxyData = function (proxy) {
  return {
    proxy: proxy.proxy,
    lastUsedTime: new Date().getTime() - (Math.random() * 3600000), // make next timing more even
    usedCount: 1,  //at least
    source: proxy.source
  };
};