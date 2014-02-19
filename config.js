var fwk = require('fwk');
var config = fwk.baseConfig();

/* These properties will be taken from your environments */
config['AWS_ACCESS_KEY_ID'] = 'dummy-env';
config['AWS_SECRET_ACCESS_KEY'] = 'dummy-env';
config['AWS_SESSION_TOKEN'] = 'dummy-env';
config['AWS_REGION'] = 'dummy-env';

config['AWS_CLOUDWATCH_COMMIT_ITV'] = 5000;
config['AWS_CLOUDWATCH_DEBUG'] = false;

exports.config = config;
