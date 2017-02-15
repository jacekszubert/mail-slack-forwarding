'use strict';
const _ = require('lodash');
const AWS = require('aws-sdk');
const url = require('url');
const https = require('https');

const slackChannel = process.env.slack_channel;
const slackHookKmsEncrypted = process.env.slack_hook_kms_encrypted;
let hookUrl;

exports.handler = (event, context, callback) => {
    console.log('Received event:', JSON.stringify(event, null, 2));
    const message = JSON.parse(event.Records[0].Sns.Message);

    switch(message.notificationType) {
        case 'Received':
            handleReceived(message, callback);
            break;
        default:
            callback(`Unknown notification type: ${message.notificationType}`);
    }
};

function handleReceived(message, callback) {
    const sourceAddress = _.result(_.find(message.mail.headers, {'name': 'From'}), 'value');
    const sourceSubject = _.result(_.find(message.mail.headers, {'name': 'Subject'}), 'value');
    const sourceForwardedFor = _.result(_.find(message.mail.headers, {'name': 'Delivered-To'}), 'value');

    const slackMessage = {
        channel: slackChannel,
        text: `from:\t\t${sourceAddress}\nto:\t\t\t${sourceForwardedFor}\nsubject:\t${sourceSubject}`,
    };

    const encryptedBuf = new Buffer(slackHookKmsEncrypted, 'base64');
    const cipherText = {CiphertextBlob: encryptedBuf};

    const kms = new AWS.KMS();
    kms.decrypt(cipherText, (err, data) => {
        if (err) {
            console.log('Decrypt error:', err);
            return callback(err);
        }
        hookUrl = `https://${data.Plaintext.toString('ascii')}`;
        console.log(hookUrl)
        postMessage(slackMessage, (response) => {
            if (response.statusCode < 400) {
                console.info('Message posted successfully');
                callback(null);
            } else {
                console.error(`Error posting message to Slack API: ${response.statusCode} - ${response.statusMessage}`);
                callback(null);
            }
        });
    });
}

function postMessage(message, callback) {
    const body = JSON.stringify(message);
    const options = url.parse(hookUrl);
    options.method = 'POST';
    options.headers = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
    };

    const postReq = https.request(options, (res) => {
        const chunks = [];
        res.setEncoding('utf8');
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
            if (callback) {
                callback({
                    body: chunks.join(''),
                    statusCode: res.statusCode,
                    statusMessage: res.statusMessage,
                });
            }
        });
        return res;
    });

    postReq.write(body);
    postReq.end();
}
