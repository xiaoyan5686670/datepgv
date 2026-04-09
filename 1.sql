SELECT
  `u`.`real_name`,
  IFNULL(SUM(CAST(`r`.`renlingjine` AS DECIMAL(18, 2))), 0) AS `sales_amount`
FROM
  `ODS`.`ODS_CRM_user` AS `u`
  JOIN `ODS`.`ODS_CRM_yewujinglitongxunlum` AS `y` ON `u`.`user_id` = `y`.`owner`
  LEFT JOIN `ODS`.`ODS_CRM_renkuanmingx1` AS `r` ON `y`.`renyuanbianma` = `r`.`bianma`
    AND DATE_FORMAT(`r`.`renkuanshijian`, '%Y-%m-%d') = DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 DAY), '%Y-%m-%d')
WHERE
  `u`.`disabled` = 'false'
  AND `y`.`disable` = 0
GROUP BY
  `u`.`real_name`
ORDER BY
  `sales_amount` DESC;