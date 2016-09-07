'use strict';

let async = require("async"),
    request = require('request'),
    cheerio = require('cheerio'),
    logger = require('../logger').getLogger();

exports.robProxy = function (done) {
  async.timesLimit(10, 3, function (n, next) {
    let url = 'http://www.kuaidaili.com/proxylist/{p}/'.replace('{p}', n + 1);
    logger.info('rob: %s', url);
    request({
      url: url,
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 9_1 like Mac OS X) AppleWebKit/601.1.46 (KHTML, like Gecko) Version/9.0 Mobile/13B143 Safari/601.1'
      }
    }, function (err, response, body) {
      let list = [];
      if (!err && response.statusCode == 200) {
        let $ = cheerio.load(body);
        $('.table-index tr').each(function (i, el) {
          let $tds = $(el).find('td'), 
              host = $tds.eq(0).text().trim(), 
              port = $tds.eq(1).text().trim();
          if (host && port) {
            list.push(host + ':' + port);
          }
        });
      } else {
        err = {err: err, statusCode: response.statusCode};
      }
      next(err, list);
    });
  }, function (err, lists) {
    let totalList = [];
    lists.forEach(function (l) {
      totalList = totalList.concat(l);
    });
    done(err, totalList);
  });
};