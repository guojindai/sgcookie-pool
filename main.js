'use strict';

const async = require("async"),
      assert = require('assert'),
      fs = require('fs'),
      request = require('request'),
      redis = require("redis"),
      logger = require('./logger').getLogger(),
      data = require('./data');

const App = {};

const main = function () {
  //logger.level = 'debug';
  initData();
  initRedis();
  startRun();
  process.on('SIGINT', closeResource);
  process.on('SIGTERM', closeResource);
};

const initData = function () {
  App.proxyGood = data.readProxyData('proxygood');
  App.proxyBad = data.readProxyData('proxybad');
  App.lastCookieTime = new Date().getTime();
  logger.info('initData end: App.proxygood: %d, App.proxybad: %s', App.proxyGood.list.length, App.proxyBad.list.length);
};

const initRedis = function () {
  App.redisClient = redis.createClient({
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
    password: process.env.REDIS_PASSWORD
  });
};

const closeResource = function () {
  logger.info('close resource before exit');
  App.redisClient.quit();
  process.exit();
};

const startRun = function () {  
  async.forever(
    function (next) {
      logger.info('startRun: start');
      async.waterfall([
        robProxy,
        filterProxyFast, 
        generateCookieUsingGoodProxy
      ], function () {
        logger.info('startRun: end');
        next();
      });
    },
    function (err) {
      logger.error('startRun', err);      
    }
  );
};

const robProxy = function (next) {
  let proxyList = [];
  fs.readdir('proxy', function (err, files) {
    assert.equal(err, null);
    async.eachLimit(files, 1, function (file, done) {
      if (file.indexOf('.js') >= 0) {
        let source = file.replace('.js', ''),
            module = './proxy/' + source,
            proxyRobber = require(module);
        logger.info(module + ' start');
        proxyRobber.robProxy(function (err, oneProxyList) {
          if (err) {
            logger.error(module + ' error', err);
          } else {
            logger.info(module + ' end %d', oneProxyList.length);
            proxyList = proxyList.concat(oneProxyList.map(function (proxy) {
              return {proxy: proxy, source: source};
            }));
          }
          done();
        });        
      } else {
        done();
      }      
    }, function (err) {
      next(err, proxyList);
    });
  });
};

const filterProxyFast = function (proxyList, next) {
  logger.info('filterProxyFast: proxyGood length', App.proxyGood.list.length);
  async.eachLimit(proxyList, 50, function(proxy, done) {
    if (App.proxyGood.map[proxy.proxy]) {
      logger.debug('filterProxyFast: proxy exists %s', proxy.proxy);
      done();
    } else {
      doGenerateCookie(proxy.proxy, function (err, cookie) {
        if (err) {
          logger.debug('filterProxyFast: %s', err);
          done();
        } else {
          logger.info('filterProxyFast: good proxy %s, %s', proxy.proxy, proxy.source);
          data.addProxy(App.proxyGood, proxy, cookie, function () {
            sendCookieToRedis(cookie, done);
          });
        }
      });
    }    
  }, function(err) {
    assert.equal(err, null);
    logger.info('filterProxyFast: proxyGood length %s, proxyBad length %s', App.proxyGood.list.length, App.proxyBad.list.length);
    data.storeProxyData('proxygood', App.proxyGood);
    data.storeProxyData('proxybad', App.proxyBad);
    next();
  });
};

const generateCookieUsingGoodProxy = function (next) {
  logger.info('generateCookieUsingGoodProxy start');
  let proxyGoodList = [];
  async.eachOfLimit(App.proxyGood.list, 1, function(proxy, i, done) {
    let now = new Date().getTime();
    // one proxy will be used per hour, except there is no new cookie more than two 2 minutes.
    if (now - proxy.lastUsedTime >= 3600000 /* 1h */ || 
        now - App.lastCookieTime >= 120000 /* 2m */) {
      doGenerateCookie(proxy.proxy, function (err, cookie) {
        if (err) {
          logger.debug('generateCookieUsingGoodProxy: %s', err);
          App.proxyBad.list.push(proxy);
          App.proxyBad.map[proxy.proxy] = proxy;
          delete App.proxyGood.map[proxy.proxy];
          done();
        } else {
          logger.info('generateCookieUsingGoodProxy: good proxy %s', proxy.proxy);
          proxy.usedCount ++;
          proxy.lastUsedTime = new Date().getTime();
          proxyGoodList.push(proxy);        
          data.storeCookie(proxy.proxy, cookie, function () {
            sendCookieToRedis(cookie, done);
          });
        }
      });
    } else {
      proxyGoodList.push(proxy);    
      logger.debug('generateCookieUsingGoodProxy: too offten %s', proxy.proxy);
      done();
    }
  }, function(err) {
    assert.equal(err, null);
    App.proxyGood.list = proxyGoodList;
    next();
  });
};

const doGenerateCookie = function (proxy, done) {
  logger.debug('doGenerateCookie proxy: %s', proxy);
  request({
    url: 'http://weixin.sogou.com/weixin?type=1&fr=sgsearch&ie=utf8&dr=1&query=%E6%9D%AD%E5%B7%9E%E5%8F%91%E5%B8%83',
    timeout: 45000,
    proxy: 'http://' + proxy
  }, function (err, response, body) {
    if (!err && response.headers['set-cookie']) {
      let cookie = response.headers['set-cookie'].map(function (c) {
        return c.split(';')[0].trim();
      }).concat(['SUV=' + (new Date().getTime() * 1000 + Math.round(Math.random() * 1000))]).join(';');
      if (cookie.indexOf('SNUID=') >= 0) {
        App.lastCookieTime = new Date().getTime();
        done(null, cookie);
      } else {
        done('bad proxy without SNUID');
      }      
    } else {
      done('bad proxy', err);
    }
  });  
};

const sendCookieToRedis = function (cookie, done) {
  App.redisClient.keys('sgcookie_key_*', function (err, replies) {
    assert.equal(err, null);
    let repliesMap = {}, key = 'sgcookie_key_', i;
    replies.forEach(function (o) {
      repliesMap[parseInt(o.replace('sgcookie_key_', ''))] = true;
    });
    for (i = 0; i < 30; i ++) {
      if (!repliesMap[i]) {
        break;
      }
    }
    if (i === 30) {
      i = parseInt(Math.random() * 30);
    }
    key += i;
    logger.info('sendCookieToRedis: %s=%s', key, cookie);
    App.redisClient.set(key, cookie, function (err) {
      assert.equal(err, null);
      done();
    });
  });
};

main();