// blvd365.com/webapp is a temporary demo domain — update API_BASE_URL here
// once the real WordPress site moves to its permanent domain. To test against
// scripts/mock-license-server.mjs instead, override both via env vars:
//   PPTMIRROR_API_BASE_URL=http://localhost:4321
//   PPTMIRROR_LICENSE_PUBLIC_KEY=e0bc804925a290a94cc833eaa13a20fc0023ccec66211f2b4dd74ebfe55c141e
module.exports = {
  API_BASE_URL: process.env.PPTMIRROR_API_BASE_URL || 'https://blvd365.com/webapp/wp-json/pptmirror/v1',
  LICENSE_PUBLIC_KEY_HEX:
    process.env.PPTMIRROR_LICENSE_PUBLIC_KEY ||
    '3aa715de9825c74d29b6b30c6ec348dd335dbf72158ae86a9363894c21688c9c',
};
