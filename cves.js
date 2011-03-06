var CVEs =
 [ { id: 'CVE-2010-0009'
   , url: 'http://web.nvd.nist.gov/view/vuln/detail?vulnId=CVE-2010-0009'
   , overview: 'Apache CouchDB 0.8.0 through 0.10.1 allows remote attackers to obtain sensitive information by measuring the completion time of operations that verify (1) hashes or (2) passwords.'
   , applies: function(major, minor, revision) { return (major === 0) && (minor <= 9 || (minor == 10 && revision <= 1)) }
   }
 , { id: 'CVE-2010-2234'
   , url: 'http://web.nvd.nist.gov/view/vuln/detail?vulnId=CVE-2010-2234'
   , overview: 'Cross-site request forgery (CSRF) vulnerability in Apache CouchDB 0.8.0 through 0.11.0 allows remote attackers to hijack the authentication of administrators for direct requests to an installation URL.'
   , applies: function(major, minor, revision) { return (major === 0) && (minor <= 10 || (minor == 11 && revision == 0)) }
   }
 , { id: 'CVE-2010-3854'
   , url: 'http://web.nvd.nist.gov/view/vuln/detail?vulnId=CVE-2010-3854'
   , overview: 'Multiple cross-site scripting (XSS) vulnerabilities in the web administration interface (aka Futon) in Apache CouchDB 0.8.0 through 1.0.1 allow remote attackers to inject arbitrary web script or HTML via unspecified vectors.'
   , applies: function(major, minor, revision) { return (major === 0) || (major == 1 && minor == 0 && revision <= 1) }
   }
 ]

exports.matching = function(major, minor, revision, cb) {
  CVEs.forEach(function(cve) {
    if(cve.applies(major, minor, revision))
      cb && cb(cve);
  })
}
