SELECT
  u.`real_name`,
  IFNULL(SUM(CAST(r.`renlingjine` AS DECIMAL(18, 2))), 0) AS `sales_amount`
FROM
  `ODS_CRM_user` u
  INNER JOIN `ODS_CRM_yewujinglitongxunlum` y ON u.`user_id` = y.`owner`
  LEFT JOIN `ODS_CRM_renkuanmingx1` r ON y.`renyuanbianma` = r.`bianma`
    AND r.`disable` = 0
    AND DATE(r.`renlingshijian`) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)
WHERE
  u.`disabled` = 'false'
  AND u.`status` = 1
  AND y.`disable` = 0
GROUP BY
  u.`user_id`,
  u.`real_name`
ORDER BY
  `sales_amount` DESC;